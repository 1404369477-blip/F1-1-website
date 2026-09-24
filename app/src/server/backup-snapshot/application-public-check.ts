import { canonicalJson } from "../db/profile.ts";
import { PublicProjectionRecordSchema, type PublicProjectionRecord } from "../review-real/schema.ts";

/** Select directly from the authenticated generation. Feed pagination and event
 * clustering must not hide the only X record from the restoration drill. */
export function selectApplicationDrillRecords(records: readonly PublicProjectionRecord[]): readonly PublicProjectionRecord[] {
  const parsed = records.map(record => PublicProjectionRecordSchema.parse(record));
  return [parsed.find(record => record.source.platform === "rss"), parsed.find(record => record.source.platform === "x")]
    .filter((record): record is PublicProjectionRecord => record !== undefined);
}

export function verifyApplicationDrillDetail(record: PublicProjectionRecord, response: unknown): void {
  const expected = PublicProjectionRecordSchema.parse(record);
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("APPLICATION_DRILL_PUBLIC_DETAIL_INVALID");
  const dto = response as { schemaVersion?: unknown; story?: Record<string, unknown> };
  if (dto.schemaVersion !== "public-read-v0.1" || !dto.story || typeof dto.story !== "object") throw new Error("APPLICATION_DRILL_PUBLIC_DETAIL_INVALID");
  const story = dto.story;
  const fields = ["publicId", "contentType", "state", "titleZh", "summaryZh", "publishedAt", "sourcePublishedAt", "sourceTimeStatus", "source", "media", "originalLink"] as const;
  for (const field of fields) if (canonicalJson(story[field]) !== canonicalJson(expected[field])) throw new Error("APPLICATION_DRILL_PUBLIC_DETAIL_MISMATCH");
  for (const field of ["leadZh", "bodyZh", "keyPointsZh"] as const) {
    if (canonicalJson(story[field]) !== canonicalJson(expected.detail[field])) throw new Error("APPLICATION_DRILL_PUBLIC_DETAIL_MISMATCH");
  }
}
