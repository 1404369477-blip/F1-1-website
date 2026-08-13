import { createHash } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";

import type { AppConfig } from "../config/env.ts";
import { assertPublicSyntheticSeeded } from "../db/public-synthetic.ts";
import { assertPublicMultimediaSeeded } from "../db/public-multimedia-synthetic.ts";
import { canonicalJson } from "../db/profile.ts";
import type { SqliteDatabase } from "../db/database.ts";
import { encodePublicCursor, isCanonicalUtc, isPublicContentType, isPublicId } from "./cursor.ts";
import { asPublicReadError, PublicReadError } from "./error.ts";
import type {
  PublicContentType,
  PublicFeedItemV1,
  PublicFeedItemV2,
  PublicFeedQuery,
  PublicFeedResponseV1,
  PublicFeedResponseV2,
  PublicReadVersion,
  PublicStoryDetailResponseV1,
  PublicStoryDetailResponseV2
} from "./types.ts";

type JsonRecord = Record<string, unknown>;

type ChainRow = Record<string, unknown>;

type VerifiedStory = {
  item: PublicFeedItemV1;
  itemV2?: PublicFeedItemV2;
  leadZh: string;
  bodyZh: string[];
  keyPointsZh: string[];
};

const FENCE_KEYS = [
  "source_config_epoch",
  "source_safety_epoch",
  "authorization_version",
  "policy_epoch",
  "recovery_epoch"
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  return value as JsonRecord;
}

function parsePayload(value: unknown): JsonRecord {
  if (typeof value !== "string") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  try {
    return record(JSON.parse(value), "payload");
  } catch (error) {
    if (error instanceof PublicReadError) throw error;
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  return value;
}

function nullableText(value: unknown, max: number): string | null {
  if (value === null) return null;
  return text(value, 1, max);
}

function textArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const result = value.map((item) => text(item, 1, maxLength));
  if (new Set(result).size !== result.length && maxLength <= 240) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  return result;
}

function equal(left: unknown, right: unknown): void {
  if (left !== right) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
}

function verifyFences(bundle: JsonRecord, decision: JsonRecord, publication: JsonRecord): void {
  const payloadFences = record(record(bundle.canonical_payload, "canonical payload").fences, "payload fences");
  for (const key of FENCE_KEYS) {
    const value = bundle[key];
    if (!Number.isInteger(value) || Number(value) < 1) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    equal(decision[key], value);
    equal(publication[key], value);
    equal(payloadFences[key], value);
  }
}

function verifySqlColumns(row: ChainRow, projection: JsonRecord, publication: JsonRecord, decision: JsonRecord, bundle: JsonRecord, content: JsonRecord, summary: JsonRecord): void {
  for (const [column, payload, key] of [
    ["p_public_id", projection, "public_id"],
    ["p_content_id", projection, "content_id"],
    ["p_summary_id", projection, "summary_id"],
    ["p_bundle_id", projection, "release_bundle_id"],
    ["p_status", projection, "projection_status"],
    ["p_version_hash", projection, "published_version_hash"],
    ["u_public_id", publication, "public_id"],
    ["u_content_id", publication, "content_id"],
    ["u_summary_id", publication, "summary_id"],
    ["u_bundle_id", publication, "release_bundle_id"],
    ["u_status", publication, "publication_status"],
    ["u_bundle_hash", publication, "approved_bundle_hash"],
    ["u_version_hash", publication, "published_version_hash"],
    ["u_published_at", publication, "published_at"],
    ["d_bundle_id", decision, "release_bundle_id"],
    ["d_decision", decision, "decision"],
    ["d_bundle_hash", decision, "approved_bundle_hash"],
    ["b_bundle_id", bundle, "release_bundle_id"],
    ["b_content_id", bundle, "content_id"],
    ["b_summary_id", bundle, "summary_id"],
    ["b_status", bundle, "release_status"],
    ["b_hash", bundle, "bundle_hash"],
    ["c_content_id", content, "content_id"],
    ["c_source_id", content, "source_id"],
    ["c_category", content, "editorial_category"],
    ["c_hash", content, "content_version_hash"],
    ["c_status", content, "content_status"],
    ["s_summary_id", summary, "summary_id"],
    ["s_content_id", summary, "content_id"],
    ["s_hash", summary, "summary_version_hash"],
    ["s_status", summary, "summary_status"]
  ] as const) equal(row[column], payload[key]);
  equal(Number(row.p_synthetic_only), projection.synthetic_only === true ? 1 : 0);
  equal(Number(row.p_external_calls), projection.external_calls);
  equal(Number(row.b_immutable), bundle.immutable === true ? 1 : 0);
  equal(Number(row.d_immutable), decision.immutable === true ? 1 : 0);
}

function buildVerifiedStory(row: ChainRow): VerifiedStory {
  const projection = parsePayload(row.projection_json);
  const publication = parsePayload(row.publication_json);
  const decision = parsePayload(row.decision_json);
  const bundle = parsePayload(row.bundle_json);
  const content = parsePayload(row.content_json);
  const summary = parsePayload(row.summary_json);
  verifySqlColumns(row, projection, publication, decision, bundle, content, summary);

  if (
    projection.projection_status !== "published" || projection.synthetic_only !== true || projection.external_calls !== 0 ||
    publication.publication_status !== "published" || publication.emergency_stop !== false ||
    bundle.release_status !== "approved" || bundle.immutable !== true ||
    decision.decision !== "approved" || decision.immutable !== true ||
    content.content_status !== "published" || summary.summary_status !== "approved"
  ) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");

  for (const key of ["public_id", "content_id", "summary_id", "release_bundle_id", "published_version_hash"] as const) {
    equal(projection[key], publication[key]);
  }
  equal(projection.publish_generation, publication.publish_generation);
  equal(decision.release_bundle_id, bundle.release_bundle_id);
  equal(decision.content_id, content.content_id);
  equal(decision.summary_id, summary.summary_id);
  equal(bundle.content_id, content.content_id);
  equal(bundle.summary_id, summary.summary_id);
  equal(publication.approved_bundle_hash, bundle.bundle_hash);
  equal(decision.approved_bundle_hash, bundle.bundle_hash);
  equal(publication.approved_content_version_hash, content.content_version_hash);
  equal(publication.approved_summary_version_hash, summary.summary_version_hash);

  equal(content.content_version_hash, sha256(canonicalJson(content.content_hash_input)));
  equal(summary.summary_version_hash, sha256(canonicalJson(summary.summary_hash_input)));
  equal(bundle.payload_hash, sha256(canonicalJson(bundle.canonical_payload)));
  equal(bundle.bundle_hash, sha256(canonicalJson(bundle.bundle_hash_input)));
  equal(decision.decision_hash, sha256(canonicalJson(decision.decision_hash_input)));
  equal(
    publication.published_version_hash,
    sha256(`synthetic:published:${text(publication.publication_id, 1, 160)}:v1`)
  );
  verifyFences(bundle, decision, publication);

  const canonicalPayload = record(bundle.canonical_payload, "canonical payload");
  const contentSnapshot = record(canonicalPayload.content_snapshot, "content snapshot");
  const summarySnapshot = record(canonicalPayload.summary_snapshot, "summary snapshot");
  const sourceSnapshot = record(canonicalPayload.source_snapshot, "source snapshot");
  const access = record(canonicalPayload.access_snapshot, "access snapshot");
  const time = record(canonicalPayload.time_snapshot, "time snapshot");
  const mediaPresentation = record(canonicalPayload.media_presentation, "media presentation");

  equal(contentSnapshot.content_version_hash, content.content_version_hash);
  equal(summarySnapshot.summary_version_hash, summary.summary_version_hash);
  equal(contentSnapshot.content_id, content.content_id);
  equal(summarySnapshot.summary_id, summary.summary_id);
  equal(summarySnapshot.content_id, content.content_id);
  equal(sourceSnapshot.source_id, "src-active");
  equal(content.source_id, "src-active");
  equal(contentSnapshot.source_id, "src-active");

  const publicId = text(projection.public_id, 1, 127);
  if (!isPublicId(publicId)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const contentType = text(contentSnapshot.editorial_category, 1, 40);
  if (!isPublicContentType(contentType)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const publishedAt = text(publication.published_at, 1, 40);
  if (!isCanonicalUtc(publishedAt)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const sourceTimeStatus = text(time.source_time_status, 1, 20);
  if (sourceTimeStatus !== "known" && sourceTimeStatus !== "unknown") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  equal(sourceTimeStatus, contentSnapshot.source_time_status);
  const sourcePublishedAt = time.source_published_at === null ? null : text(time.source_published_at, 1, 40);
  if ((sourceTimeStatus === "known") !== (sourcePublishedAt !== null)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");

  const contentAccess = text(access.content_access_status, 1, 30);
  if (contentAccess !== "available" && contentAccess !== "source_restricted") {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const reason = text(access.original_link_reason, 1, 30);
  if (reason !== "synthetic_only" && reason !== "source_restricted") {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const mediaMode = text(mediaPresentation.mode, 1, 30);
  if (mediaMode !== "synthetic_placeholder" && mediaMode !== "none") {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const state = contentAccess === "source_restricted" ? "restricted" : mediaMode === "none" ? "media_missing" : "available";
  let media: PublicFeedItemV1["media"] = null;
  if (mediaMode === "synthetic_placeholder") {
    const assetRef = text(mediaPresentation.asset_ref, 1, 180);
    const tone = text(mediaPresentation.tone, 1, 12);
    if (!assetRef.startsWith("synthetic:") || assetRef.includes("://") || !["night", "blue", "amber", "violet", "slate"].includes(tone)) {
      throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    }
    media = {
      kind: "synthetic_placeholder",
      assetRef,
      altZh: text(mediaPresentation.alt_zh, 1, 300),
      captionZh: nullableText(mediaPresentation.caption_zh, 300),
      creditDisplay: nullableText(mediaPresentation.credit_display, 120),
      tone: tone as "night" | "blue" | "amber" | "violet" | "slate"
    };
  } else if (mediaPresentation.asset_ref !== null) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }

  const platform = text(sourceSnapshot.platform, 1, 20);
  if (!["x", "instagram", "reddit", "website", "rss"].includes(platform)) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const item: PublicFeedItemV1 = {
    publicId,
    contentType: contentType as PublicContentType,
    state,
    titleZh: text(summarySnapshot.title_zh, 1, 400),
    summaryZh: text(summarySnapshot.summary_zh, 1, 1200),
    publishedAt,
    sourcePublishedAt,
    sourceTimeStatus,
    source: {
      sourceId: "src-active",
      platform: platform as PublicFeedItemV1["source"]["platform"],
      displayName: text(sourceSnapshot.display_name, 1, 120),
      byline: text(sourceSnapshot.byline, 1, 120),
      accessStatus: contentAccess === "source_restricted" ? "restricted" : "available"
    },
    media,
    originalLink: { enabled: false, url: null, reason }
  };
  return {
    item,
    leadZh: text(summarySnapshot.lead_zh, 1, 400),
    bodyZh: textArray(summarySnapshot.body_zh, 8, 1200),
    keyPointsZh: textArray(summarySnapshot.key_points_zh, 8, 240)
  };
}

const CHAIN_SQL = `
SELECT
  p.payload_json AS projection_json,
  p.public_id AS p_public_id,
  p.content_id AS p_content_id,
  p.summary_id AS p_summary_id,
  p.release_bundle_id AS p_bundle_id,
  p.projection_status AS p_status,
  p.published_version_hash AS p_version_hash,
  p.synthetic_only AS p_synthetic_only,
  p.external_calls AS p_external_calls,
  u.payload_json AS publication_json,
  u.public_id AS u_public_id,
  u.content_id AS u_content_id,
  u.summary_id AS u_summary_id,
  u.release_bundle_id AS u_bundle_id,
  u.publication_status AS u_status,
  u.approved_bundle_hash AS u_bundle_hash,
  u.published_version_hash AS u_version_hash,
  u.published_at AS u_published_at,
  d.payload_json AS decision_json,
  d.release_bundle_id AS d_bundle_id,
  d.decision AS d_decision,
  d.approved_bundle_hash AS d_bundle_hash,
  d.immutable AS d_immutable,
  b.payload_json AS bundle_json,
  b.release_bundle_id AS b_bundle_id,
  b.content_id AS b_content_id,
  b.summary_id AS b_summary_id,
  b.release_status AS b_status,
  b.bundle_hash AS b_hash,
  b.immutable AS b_immutable,
  b.media_presentations_json AS b_media_presentations_json,
  c.payload_json AS content_json,
  c.content_id AS c_content_id,
  c.source_id AS c_source_id,
  c.editorial_category AS c_category,
  c.content_version_hash AS c_hash,
  c.content_status AS c_status,
  s.payload_json AS summary_json,
  s.summary_id AS s_summary_id,
  s.content_id AS s_content_id,
  s.summary_version_hash AS s_hash,
  s.summary_status AS s_status
FROM published_projection AS p
JOIN public_publication AS u ON u.public_id = p.public_id
JOIN public_release_bundle AS b ON b.release_bundle_id = p.release_bundle_id
JOIN public_review_decision AS d ON d.release_bundle_id = b.release_bundle_id
JOIN public_content AS c ON c.content_id = p.content_id
JOIN public_summary AS s ON s.summary_id = p.summary_id
WHERE p.public_id = ?`;

const CHAIN_SQL_V1 = CHAIN_SQL.replace(
  "b.media_presentations_json AS b_media_presentations_json,",
  "NULL AS b_media_presentations_json,"
);

function buildVerifiedMultimediaStory(row: ChainRow, database: SqliteDatabase): VerifiedStory {
  const projection = parsePayload(row.projection_json);
  const publication = parsePayload(row.publication_json);
  const decision = parsePayload(row.decision_json);
  const bundle = parsePayload(row.bundle_json);
  const content = parsePayload(row.content_json);
  const summary = parsePayload(row.summary_json);
  verifySqlColumns(row, projection, publication, decision, bundle, content, summary);
  if (
    projection.projection_status !== "published" || projection.synthetic_only !== true || projection.external_calls !== 0 ||
    publication.publication_status !== "published" || publication.emergency_stop !== false ||
    bundle.release_status !== "approved" || bundle.immutable !== true ||
    decision.decision !== "approved" || decision.immutable !== true ||
    content.content_status !== "published" || summary.summary_status !== "approved"
  ) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  for (const key of ["public_id", "content_id", "summary_id", "release_bundle_id", "published_version_hash"] as const) equal(projection[key], publication[key]);
  equal(projection.publish_generation, publication.publish_generation);
  equal(decision.release_bundle_id, bundle.release_bundle_id);
  equal(decision.content_id, content.content_id);
  equal(decision.summary_id, summary.summary_id);
  equal(bundle.content_id, content.content_id);
  equal(bundle.summary_id, summary.summary_id);
  equal(publication.approved_bundle_hash, bundle.bundle_hash);
  equal(decision.approved_bundle_hash, bundle.bundle_hash);
  equal(publication.approved_content_version_hash, content.content_version_hash);
  equal(publication.approved_summary_version_hash, summary.summary_version_hash);
  equal(content.content_version_hash, sha256(canonicalJson(content.content_hash_input)));
  equal(summary.summary_version_hash, sha256(canonicalJson(summary.summary_hash_input)));
  equal(bundle.payload_hash, sha256(canonicalJson(bundle.canonical_payload)));
  equal(bundle.bundle_hash, sha256(canonicalJson(bundle.bundle_hash_input)));
  equal(decision.decision_hash, sha256(canonicalJson(decision.decision_hash_input)));
  equal(publication.published_version_hash, sha256(canonicalJson({
    approved_bundle_hash: publication.approved_bundle_hash,
    approved_content_version_hash: publication.approved_content_version_hash,
    approved_summary_version_hash: publication.approved_summary_version_hash,
    public_id: publication.public_id,
    publish_generation: publication.publish_generation,
    release_bundle_id: publication.release_bundle_id
  })));
  verifyFences(bundle, decision, publication);

  const canonicalPayload = record(bundle.canonical_payload, "canonical payload");
  const contentSnapshot = record(canonicalPayload.content_snapshot, "content snapshot");
  const summarySnapshot = record(canonicalPayload.summary_snapshot, "summary snapshot");
  const sourceSnapshot = record(canonicalPayload.source_snapshot, "source snapshot");
  const access = record(canonicalPayload.access_snapshot, "access snapshot");
  const time = record(canonicalPayload.time_snapshot, "time snapshot");
  const rights = record(canonicalPayload.rights, "rights snapshot");
  equal(contentSnapshot.content_version_hash, content.content_version_hash);
  equal(summarySnapshot.summary_version_hash, summary.summary_version_hash);
  equal(contentSnapshot.content_id, content.content_id);
  equal(summarySnapshot.summary_id, summary.summary_id);
  equal(summarySnapshot.content_id, content.content_id);
  if (rights.rights_status !== "allowed") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");

  const refs = bundle.media_refs;
  const mediaSnapshots = canonicalPayload.media;
  const presentations = canonicalPayload.media_presentations;
  if (!Array.isArray(refs) || !Array.isArray(mediaSnapshots) || !Array.isArray(presentations) || refs.length > 4 || refs.length !== mediaSnapshots.length || refs.length !== presentations.length) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const mediaIds = refs.map((value) => text(value, 1, 160));
  if (new Set(mediaIds).size !== mediaIds.length || row.b_media_presentations_json !== canonicalJson(presentations)) {
    throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }
  const candidateRows = database.prepare("SELECT media_candidate_id, content_id, media_hash, candidate_status, payload_json FROM public_media_candidate WHERE content_id=? ORDER BY media_candidate_id")
    .all(String(content.content_id)) as JsonRecord[];
  if (candidateRows.length !== mediaIds.length) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const candidateMap = new Map(candidateRows.map((candidate) => [String(candidate.media_candidate_id), candidate]));
  const mediaV2 = mediaIds.map((mediaId, index): PublicFeedItemV2["media"][number] => {
    const candidateRow = candidateMap.get(mediaId);
    if (!candidateRow) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    const candidate = parsePayload(candidateRow.payload_json);
    const snapshot = record(mediaSnapshots[index], "media snapshot");
    const presentation = record(presentations[index], "media presentation");
    equal(candidateRow.media_candidate_id, candidate.media_candidate_id);
    equal(candidateRow.content_id, candidate.content_id);
    equal(candidateRow.media_hash, candidate.media_hash);
    equal(candidateRow.candidate_status, candidate.candidate_status);
    equal(candidate.content_id, content.content_id);
    equal(candidate.media_candidate_id, mediaId);
    equal(snapshot.media_candidate_id, mediaId);
    equal(presentation.media_candidate_id, mediaId);
    equal(snapshot.media_hash, candidate.media_hash);
    equal(snapshot.license_status, candidate.license_status);
    equal(snapshot.safety_status, candidate.safety_status);
    if (candidate.candidate_status !== "selected" || candidate.license_status !== "allowed" || candidate.safety_status !== "passed" || candidate.mime_type !== "image/webp") {
      throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    }
    const assetRef = text(candidate.asset_ref, 1, 180);
    const mediaHash = text(candidate.media_hash, 64, 64);
    const tone = text(presentation.tone, 1, 12);
    if (!assetRef.startsWith("synthetic:") || assetRef.includes("://") || !/^[a-f0-9]{64}$/.test(mediaHash) || !["night", "blue", "amber", "violet", "slate"].includes(tone)) {
      throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    }
    return {
      kind: "synthetic_placeholder",
      mediaId,
      assetRef,
      mediaHash,
      altZh: text(presentation.alt_zh, 1, 300),
      captionZh: nullableText(presentation.caption_zh, 300),
      creditDisplay: nullableText(presentation.credit_display, 120),
      tone: tone as PublicFeedItemV2["media"][number]["tone"]
    };
  });

  const legacyPresentation = record(canonicalPayload.media_presentation, "legacy media presentation");
  if (mediaV2.length === 0) {
    if (legacyPresentation.mode !== "none" || legacyPresentation.asset_ref !== null) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  } else {
    const first = mediaV2[0];
    if (
      legacyPresentation.mode !== first.kind || legacyPresentation.asset_ref !== first.assetRef ||
      legacyPresentation.alt_zh !== first.altZh || legacyPresentation.caption_zh !== first.captionZh ||
      legacyPresentation.credit_display !== first.creditDisplay || legacyPresentation.tone !== first.tone
    ) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  }

  const publicId = text(projection.public_id, 1, 127);
  if (!isPublicId(publicId)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const contentType = text(contentSnapshot.editorial_category, 1, 40);
  if (!isPublicContentType(contentType)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const publishedAt = text(publication.published_at, 1, 40);
  if (!isCanonicalUtc(publishedAt)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const sourceTimeStatus = text(time.source_time_status, 1, 20);
  if (sourceTimeStatus !== "known" && sourceTimeStatus !== "unknown") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const sourcePublishedAt = time.source_published_at === null ? null : text(time.source_published_at, 1, 40);
  if ((sourceTimeStatus === "known") !== (sourcePublishedAt !== null)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const contentAccess = text(access.content_access_status, 1, 30);
  if (contentAccess !== "available" && contentAccess !== "source_restricted") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const reason = text(access.original_link_reason, 1, 30);
  if (reason !== "synthetic_only" && reason !== "source_restricted") throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const platform = text(sourceSnapshot.platform, 1, 20);
  if (!(["x", "instagram", "reddit", "website", "rss"] as string[]).includes(platform)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const state = contentAccess === "source_restricted" ? "restricted" : mediaV2.length === 0 ? "media_missing" : "available";
  const shared: Omit<PublicFeedItemV1, "media"> = {
    publicId,
    contentType: contentType as PublicContentType,
    state,
    titleZh: text(summarySnapshot.title_zh, 1, 400),
    summaryZh: text(summarySnapshot.summary_zh, 1, 1200),
    publishedAt,
    sourcePublishedAt,
    sourceTimeStatus,
    source: {
      sourceId: text(sourceSnapshot.source_id, 1, 127),
      platform: platform as PublicFeedItemV1["source"]["platform"],
      displayName: text(sourceSnapshot.display_name, 1, 120),
      byline: text(sourceSnapshot.byline, 1, 120),
      accessStatus: contentAccess === "source_restricted" ? "restricted" as const : "available" as const
    },
    originalLink: {
      enabled: false as const,
      url: null,
      reason: reason as Extract<PublicFeedItemV1["originalLink"], { enabled: false }>["reason"]
    }
  };
  const itemV2: PublicFeedItemV2 = { ...shared, media: mediaV2 };
  const first = mediaV2[0];
  const item: PublicFeedItemV1 = {
    ...shared,
    media: first ? {
      kind: first.kind,
      assetRef: first.assetRef,
      altZh: first.altZh,
      captionZh: first.captionZh,
      creditDisplay: first.creditDisplay,
      tone: first.tone
    } : null
  };
  return {
    item,
    itemV2,
    leadZh: text(summarySnapshot.lead_zh, 1, 400),
    bodyZh: textArray(summarySnapshot.body_zh, 8, 1200),
    keyPointsZh: textArray(summarySnapshot.key_points_zh, 8, 240)
  };
}

export class PublicStoryRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly config: AppConfig,
    private readonly appRoot: string,
    private readonly projectRoot: string
  ) {}

  private loadGraph(): Map<string, VerifiedStory> {
    if (this.config.dataProfile !== "public-synthetic" && this.config.dataProfile !== "public-multimedia-synthetic") {
      throw new PublicReadError("PUBLIC_PROFILE_UNAVAILABLE");
    }
    try {
      if (this.config.dataProfile === "public-synthetic") {
        assertPublicSyntheticSeeded(this.database, this.config, this.appRoot, this.projectRoot);
      } else {
        assertPublicMultimediaSeeded(this.database, this.config, this.projectRoot);
      }
      const projections = this.database.prepare(
        "SELECT public_id FROM published_projection ORDER BY public_id"
      ).all() as Array<Record<string, unknown>>;
      const expectedCount = this.config.dataProfile === "public-synthetic" ? 12 : 24;
      if (projections.length !== expectedCount) throw new PublicReadError("PUBLIC_READ_INCOMPLETE_CHAIN");
      const statement = this.database.prepare(this.config.dataProfile === "public-synthetic" ? CHAIN_SQL_V1 : CHAIN_SQL);
      const graph = new Map<string, VerifiedStory>();
      for (const projection of projections) {
        const publicId = String(projection.public_id);
        const rows = statement.all(publicId) as ChainRow[];
        if (rows.length !== 1) throw new PublicReadError("PUBLIC_READ_INCOMPLETE_CHAIN");
        if (graph.has(publicId)) throw new PublicReadError("PUBLIC_READ_INCOMPLETE_CHAIN");
        if (this.config.dataProfile === "public-multimedia-synthetic") {
          graph.set(publicId, buildVerifiedMultimediaStory(rows[0], this.database));
        } else {
          graph.set(publicId, buildVerifiedStory(rows[0]));
        }
      }
      return graph;
    } catch (error) {
      throw asPublicReadError(error);
    }
  }

  getFeed(query: PublicFeedQuery, version: PublicReadVersion = "public-read-v0.1"): PublicFeedResponseV1 | PublicFeedResponseV2 {
    if (version === "public-read-v0.2" && this.config.dataProfile !== "public-multimedia-synthetic") {
      throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    }
    const graph = this.loadGraph();
    if (query.cursor) {
      const target = graph.get(query.cursor.publicId);
      if (!target || target.item.publishedAt !== query.cursor.publishedAt) {
        throw new PublicReadError("PUBLIC_CURSOR_INVALID");
      }
      if (target.item.source.sourceId !== (query.source ?? target.item.source.sourceId) || target.item.contentType !== (query.contentType ?? target.item.contentType)) {
        throw new PublicReadError("PUBLIC_CURSOR_INVALID");
      }
    }
    const where: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (query.source) {
      where.push("c.source_id = ?");
      parameters.push(query.source);
    }
    if (query.contentType) {
      where.push("c.editorial_category = ?");
      parameters.push(query.contentType);
    }
    if (query.cursor) {
      where.push("(u.published_at < ? OR (u.published_at = ? AND p.public_id < ?))");
      parameters.push(query.cursor.publishedAt, query.cursor.publishedAt, query.cursor.publicId);
    }
    const sql = `
      SELECT p.public_id
      FROM published_projection AS p
      JOIN public_publication AS u ON u.public_id = p.public_id
      JOIN public_content AS c ON c.content_id = p.content_id
      ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
      ORDER BY u.published_at DESC, p.public_id DESC
      LIMIT 13`;
    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.database.prepare(sql).all(...parameters) as Array<Record<string, unknown>>;
    } catch (error) {
      throw asPublicReadError(error);
    }
    const selected = rows.map((row) => {
      const story = graph.get(String(row.public_id));
      if (!story) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
      if (version === "public-read-v0.2") {
        if (!story.itemV2) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
        return story.itemV2;
      }
      return story.item;
    });
    const hasMore = selected.length > 12;
    const items = selected.slice(0, 12);
    const last = items.at(-1);
    const nextCursor = hasMore && last
      ? {
          cursorAt: last.publishedAt,
          cursorId: encodePublicCursor({
            v: 1,
            publicId: last.publicId,
            publishedAt: last.publishedAt,
            source: query.source,
            contentType: query.contentType
          })
        }
      : null;
    const page = { pageSize: 12 as const, hasMore, nextCursor };
    return version === "public-read-v0.2"
      ? { schemaVersion: "public-read-v0.2", items: items as PublicFeedItemV2[], page }
      : { schemaVersion: "public-read-v0.1", items: items as PublicFeedItemV1[], page };
  }

  getDetail(publicId: string, version: PublicReadVersion = "public-read-v0.1"): PublicStoryDetailResponseV1 | PublicStoryDetailResponseV2 | null {
    if (version === "public-read-v0.2" && this.config.dataProfile !== "public-multimedia-synthetic") {
      throw new PublicReadError("PUBLIC_MEDIA_VERSION_UNSUPPORTED");
    }
    const graph = this.loadGraph();
    const selected = graph.get(publicId);
    if (!selected) return null;
    const ordered = [...graph.values()].sort((left, right) =>
      right.item.publishedAt.localeCompare(left.item.publishedAt) || right.item.publicId.localeCompare(left.item.publicId)
    );
    const sameType = ordered.filter((story) => story.item.publicId !== publicId && story.item.contentType === selected.item.contentType);
    const other = ordered.filter((story) => story.item.publicId !== publicId && story.item.contentType !== selected.item.contentType);
    const related = [...sameType, ...other].slice(0, 3);
    const selectedItem = version === "public-read-v0.2" ? selected.itemV2 : selected.item;
    if (!selectedItem) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    const relatedItems = related.map((story) => {
      const item = version === "public-read-v0.2" ? story.itemV2 : story.item;
      if (!item) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
      return item;
    });
    const response = {
      schemaVersion: version,
      story: {
        ...selectedItem,
        leadZh: selected.leadZh,
        bodyZh: selected.bodyZh,
        keyPointsZh: selected.keyPointsZh
      },
      relatedItems
    };
    return response as PublicStoryDetailResponseV1 | PublicStoryDetailResponseV2;
  }
}
