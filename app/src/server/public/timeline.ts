type PublicTimelineFields = Readonly<{
  publicId: string;
  publishedAt: string;
  sourcePublishedAt: string | null;
  sourceTimeStatus: "known" | "unknown";
}>;

export function publicTimelineAt(value: PublicTimelineFields): string {
  return value.sourceTimeStatus === "known" && value.sourcePublishedAt
    ? value.sourcePublishedAt
    : value.publishedAt;
}

export function comparePublicTimelineDescending(
  left: PublicTimelineFields,
  right: PublicTimelineFields
): number {
  const timestamp = Date.parse(publicTimelineAt(right)) - Date.parse(publicTimelineAt(left));
  if (timestamp !== 0) return timestamp;
  if (left.publicId === right.publicId) return 0;
  return left.publicId < right.publicId ? 1 : -1;
}

export function isAfterPublicTimelineCursor(
  value: PublicTimelineFields,
  cursor: Readonly<{ publicId: string; timelineAt: string }>
): boolean {
  const valueTime = Date.parse(publicTimelineAt(value));
  const cursorTime = Date.parse(cursor.timelineAt);
  return valueTime < cursorTime || (valueTime === cursorTime && value.publicId < cursor.publicId);
}
