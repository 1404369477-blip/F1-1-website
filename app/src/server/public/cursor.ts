import { Buffer } from "node:buffer";

import { canonicalJson } from "../db/profile.ts";
import { PublicReadError } from "./error.ts";
import { PUBLIC_CONTENT_TYPES, type PublicContentType, type PublicCursorPayloadV2 } from "./types.ts";

const PUBLIC_ID_PATTERN = /^public-[a-z0-9-]{1,120}$/;
const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isPublicId(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= 127 && PUBLIC_ID_PATTERN.test(value);
}

export function isSourceId(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= 128 && SOURCE_ID_PATTERN.test(value);
}

export function isCanonicalUtc(value: string): boolean {
  if (!RFC3339_UTC_PATTERN.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const normalized = new Date(time).toISOString();
  return value === normalized || (normalized.endsWith(".000Z") && value === normalized.replace(".000Z", "Z"));
}

export function isPublicContentType(value: string): value is PublicContentType {
  return (PUBLIC_CONTENT_TYPES as readonly string[]).includes(value);
}

export function encodePublicCursor(payload: PublicCursorPayloadV2): string {
  return Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
}

export function decodePublicCursor(value: string): PublicCursorPayloadV2 {
  if (Buffer.byteLength(value, "utf8") > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  }
  let bytes: Buffer;
  let parsed: unknown;
  try {
    bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("non-canonical base64url");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["contentType", "publicId", "source", "timelineAt", "v"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  }
  if (
    record.v !== 2 ||
    typeof record.publicId !== "string" ||
    !isPublicId(record.publicId) ||
    typeof record.timelineAt !== "string" ||
    !isCanonicalUtc(record.timelineAt) ||
    (record.source !== null && (typeof record.source !== "string" || !isSourceId(record.source))) ||
    (record.contentType !== null && (typeof record.contentType !== "string" || !isPublicContentType(record.contentType))) ||
    canonicalJson(record) !== bytes.toString("utf8")
  ) {
    throw new PublicReadError("PUBLIC_CURSOR_INVALID");
  }
  return record as PublicCursorPayloadV2;
}
