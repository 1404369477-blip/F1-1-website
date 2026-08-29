import { createHash, verify, type KeyObject } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { PublicReadError } from "./error.ts";
import type { PublicBilingualStoryCardV2, PublicFeedQuery } from "./types.ts";

export const PUBLIC_SCHEMA10_SHA256 = "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f" as const;
export const PUBLIC_MIGRATION_0010_SHA256 = "83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a" as const;
export const PUBLIC_BILINGUAL_POINTER_FILE = "bilingual-active.json" as const;

const HASH = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const GENERATION_FILE = /^bilingual-generation-[0-9a-f]{64}\.json$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{80,128}$/u;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_MULTILINE_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(minimum: number, maximum: number): z.ZodType<string> {
  return z.string().min(minimum).max(maximum).refine((value) => value.trim() === value && !UNSAFE_TEXT.test(value));
}

function safeMultilineText(minimum: number, maximum: number): z.ZodType<string> {
  return z.string().min(minimum).max(maximum).refine((value) =>
    value.trim() === value && !UNSAFE_MULTILINE_TEXT.test(value) && !value.includes("\r")
  );
}

const HashSchema = z.string().regex(HASH);
const IdSchema = z.string().regex(ID);
const TimestampSchema = z.string().datetime({ offset: false }).refine((value) => {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
});
const HttpsUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "" && (url.port === "" || url.port === "443");
});

function localizedSchema(language: "zh-CN" | "en") {
  return z.object({
    title: safeText(1, 200), summary: safeText(1, 600), lead: safeText(1, 600), body: safeMultilineText(1, 12_000),
    keyPoints: z.array(safeText(1, 240)).min(1).max(8).refine((values) => new Set(values).size === values.length),
    contentHash: HashSchema
  }).strict().superRefine((value, context) => {
    const expected = sha256(canonicalJson({ language, title: value.title, summary: value.summary, lead: value.lead, body: value.body.split("\n"), keyPoints: value.keyPoints }));
    if (value.contentHash !== expected) context.addIssue({ code: "custom", message: "localized content hash mismatch" });
  });
}

export const PublicBilingualPayloadSchema = z.object({
  schemaVersion: z.literal("public-read-bilingual-v2"), publicId: IdSchema, category: safeText(1, 80),
  defaultLanguage: z.literal("zh-CN"), availableLanguages: z.tuple([z.literal("zh-CN"), z.literal("en")]),
  localized: z.object({ "zh-CN": localizedSchema("zh-CN"), en: localizedSchema("en") }).strict(),
  source: z.object({ name: safeText(1, 200), author: safeText(1, 200).nullable(), publishedAt: TimestampSchema.nullable(), canonicalUrl: HttpsUrlSchema }).strict(),
  publishedAt: TimestampSchema, updatedAt: TimestampSchema,
  media: z.array(z.object({ kind: z.literal("image"), url: HttpsUrlSchema, alt: safeText(1, 300), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), rightsPolicyId: IdSchema, mediaHash: HashSchema }).strict()).max(4)
}).strict().refine((value) => value.updatedAt >= value.publishedAt, "updatedAt precedes publishedAt");

export const PublicBilingualSnapshotRecordSchema = z.object({
  projectionId: IdSchema, publicationId: IdSchema, publicationRevision: z.number().int().positive(), bundleId: IdSchema,
  bundleHash: HashSchema, pointerVersion: z.number().int().positive(), projectionHash: HashSchema, payload: PublicBilingualPayloadSchema
}).strict();

const WithdrawalSchema = z.object({
  publicId: IdSchema, publicationId: IdSchema, publicationRevision: z.number().int().min(2),
  supersededProjectionHash: HashSchema, withdrawnAt: TimestampSchema
}).strict();

export const PublicBilingualSnapshotBodySchema = z.object({
  schemaVersion: z.literal("public-bilingual-snapshot-v1"), schema10Sha256: z.literal(PUBLIC_SCHEMA10_SHA256),
  migration0010Sha256: z.literal(PUBLIC_MIGRATION_0010_SHA256), generationId: IdSchema, generatedAt: TimestampSchema,
  records: z.array(PublicBilingualSnapshotRecordSchema).max(500), withdrawals: z.array(WithdrawalSchema).max(500)
}).strict();

export const SignedPublicBilingualSnapshotSchema = z.object({
  schemaVersion: z.literal("public-bilingual-snapshot-signed-v1"), body: PublicBilingualSnapshotBodySchema,
  bodyHash: HashSchema, signingKeyId: IdSchema, signature: z.string().regex(SIGNATURE)
}).strict();

export const PublicBilingualGenerationReferenceSchema = z.object({
  file: z.string().regex(GENERATION_FILE), generationId: IdSchema, generationHash: HashSchema
}).strict();

export const PublicBilingualPointerBodySchema = z.object({
  schemaVersion: z.literal("public-bilingual-active-pointer-v1"), schema10Sha256: z.literal(PUBLIC_SCHEMA10_SHA256),
  migration0010Sha256: z.literal(PUBLIC_MIGRATION_0010_SHA256), active: PublicBilingualGenerationReferenceSchema,
  lkg: PublicBilingualGenerationReferenceSchema.nullable(), updatedAt: TimestampSchema
}).strict();

export const SignedPublicBilingualPointerSchema = z.object({
  schemaVersion: z.literal("public-bilingual-active-pointer-signed-v1"), body: PublicBilingualPointerBodySchema,
  bodyHash: HashSchema, signingKeyId: IdSchema, signature: z.string().regex(SIGNATURE)
}).strict();

export type PublicBilingualSnapshotBody = z.infer<typeof PublicBilingualSnapshotBodySchema>;
export type SignedPublicBilingualSnapshot = z.infer<typeof SignedPublicBilingualSnapshotSchema>;
export type PublicBilingualPointerBody = z.infer<typeof PublicBilingualPointerBodySchema>;
export type SignedPublicBilingualPointer = z.infer<typeof SignedPublicBilingualPointerSchema>;
export type LoadedPublicBilingualSnapshot = Readonly<{ body: PublicBilingualSnapshotBody; generationHash: string; usedLkg: boolean }>;

export function publicBilingualSnapshotSignaturePayload(bodyHash: string): Buffer {
  if (!HASH.test(bodyHash)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  return Buffer.from(`f1plus1-public-bilingual-snapshot-v1\n${bodyHash}`, "utf8");
}

export function publicBilingualPointerSignaturePayload(bodyHash: string): Buffer {
  if (!HASH.test(bodyHash)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  return Buffer.from(`f1plus1-public-bilingual-pointer-v1\n${bodyHash}`, "utf8");
}

function assertReadableRoot(path: string): string {
  try {
    const root = resolve(path); const stat = lstatSync(root); const canonical = lstatSync(realpathSync(root)); const uid = process.getuid?.();
    if (!stat.isDirectory() || stat.isSymbolicLink() || uid === undefined || stat.uid !== uid || (stat.mode & 0o077) !== 0 || stat.dev !== canonical.dev || stat.ino !== canonical.ino) throw new Error("root invalid");
    return root;
  } catch { throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED"); }
}

function readStableCanonical<T>(root: string, file: string, schema: z.ZodType<T>): T {
  if (file !== PUBLIC_BILINGUAL_POINTER_FILE && !GENERATION_FILE.test(file)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const path = join(root, file); const noFollow = fsConstants.O_NOFOLLOW ?? 0; let descriptor: number | null = null;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | noFollow); const before = fstatSync(descriptor); const pathStat = lstatSync(path); const uid = process.getuid?.();
    if (!before.isFile() || before.nlink !== 1 || uid === undefined || before.uid !== uid || (before.mode & 0o077) !== 0 || pathStat.isSymbolicLink() || before.dev !== pathStat.dev || before.ino !== pathStat.ino || before.size > MAX_SNAPSHOT_BYTES) throw new Error("file invalid");
    const raw = readFileSync(descriptor, "utf8"); const after = fstatSync(descriptor); const finalPathStat = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.dev !== finalPathStat.dev || after.ino !== finalPathStat.ino || finalPathStat.isSymbolicLink()) throw new Error("file changed");
    const parsed = schema.safeParse(JSON.parse(raw) as unknown); if (!parsed.success || raw !== canonicalJson(parsed.data)) throw new Error("canonical invalid"); return parsed.data;
  } catch { throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED"); } finally { if (descriptor !== null) closeSync(descriptor); }
}

function verifyEnvelope<T extends { body: unknown; bodyHash: string; signingKeyId: string; signature: string }>(value: T, signingKeyId: string, publicKey: KeyObject, payload: (hash: string) => Buffer): T {
  const actualHash = sha256(canonicalJson(value.body));
  if (value.bodyHash !== actualHash || value.signingKeyId !== signingKeyId || !verify(null, payload(actualHash), publicKey, Buffer.from(value.signature, "base64url"))) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  return value;
}

function verifySnapshotSemantics(value: SignedPublicBilingualSnapshot, expected: z.infer<typeof PublicBilingualGenerationReferenceSchema>): Omit<LoadedPublicBilingualSnapshot, "usedLkg"> {
  if (value.bodyHash !== expected.generationHash || value.body.generationId !== expected.generationId || expected.file !== `bilingual-generation-${value.bodyHash}.json`) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
  const publicIds = new Set<string>(); const projectionIds = new Set<string>();
  for (const record of value.body.records) {
    if (record.projectionHash !== sha256(canonicalJson(record.payload)) || publicIds.has(record.payload.publicId) || projectionIds.has(record.projectionId)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    publicIds.add(record.payload.publicId); projectionIds.add(record.projectionId);
  }
  const withdrawalIds = new Set<string>();
  for (const withdrawal of value.body.withdrawals) {
    if (publicIds.has(withdrawal.publicId) || withdrawalIds.has(withdrawal.publicId)) throw new PublicReadError("PUBLIC_READ_INTEGRITY_FAILED");
    withdrawalIds.add(withdrawal.publicId);
  }
  return Object.freeze({ body: value.body, generationHash: value.bodyHash });
}

export function readPublicBilingualSnapshot(input: Readonly<{ root: string; signingKeyId: string; publicKey: KeyObject }>): LoadedPublicBilingualSnapshot {
  const root = assertReadableRoot(input.root);
  const pointer = verifyEnvelope(readStableCanonical(root, PUBLIC_BILINGUAL_POINTER_FILE, SignedPublicBilingualPointerSchema), input.signingKeyId, input.publicKey, publicBilingualPointerSignaturePayload);
  const load = (reference: z.infer<typeof PublicBilingualGenerationReferenceSchema>) => verifySnapshotSemantics(verifyEnvelope(readStableCanonical(root, reference.file, SignedPublicBilingualSnapshotSchema), input.signingKeyId, input.publicKey, publicBilingualSnapshotSignaturePayload), reference);
  try { return Object.freeze({ ...load(pointer.body.active), usedLkg: false }); }
  catch (error) {
    if (pointer.body.lkg === null || pointer.body.lkg.generationHash === pointer.body.active.generationHash) throw error;
    return Object.freeze({ ...load(pointer.body.lkg), usedLkg: true });
  }
}

export function publicBilingualCard(record: z.infer<typeof PublicBilingualSnapshotRecordSchema>): PublicBilingualStoryCardV2 {
  const { schemaVersion: _schemaVersion, ...story } = record.payload;
  return story;
}

type BilingualCursor = Readonly<{ generationHash: string; publishedAt: string; publicId: string }>;
export function encodePublicBilingualCursor(value: BilingualCursor): string { return Buffer.from(canonicalJson(value), "utf8").toString("base64url"); }
export function decodePublicBilingualCursor(value: string): BilingualCursor {
  try {
    if (value.length < 8 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("cursor invalid");
    const raw = Buffer.from(value, "base64url").toString("utf8"); const parsed = z.object({ generationHash: HashSchema, publishedAt: TimestampSchema, publicId: IdSchema }).strict().parse(JSON.parse(raw) as unknown);
    if (raw !== canonicalJson(parsed)) throw new Error("cursor noncanonical"); return parsed;
  } catch { throw new PublicReadError("PUBLIC_CURSOR_INVALID"); }
}

export function selectPublicBilingualRecords(snapshot: LoadedPublicBilingualSnapshot, query: PublicFeedQuery): Readonly<{ records: z.infer<typeof PublicBilingualSnapshotRecordSchema>[]; nextCursor: string | null; limit: number }> {
  const limit = query.limit ?? 12; if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new PublicReadError("PUBLIC_QUERY_INVALID");
  const ordered = snapshot.body.records.filter((record) => query.category === null || query.category === undefined || record.payload.category === query.category).sort((left, right) => right.payload.publishedAt.localeCompare(left.payload.publishedAt) || right.payload.publicId.localeCompare(left.payload.publicId));
  let start = 0;
  if (query.bilingualCursor) {
    const cursor = decodePublicBilingualCursor(query.bilingualCursor); if (cursor.generationHash !== snapshot.generationHash) throw new PublicReadError("PUBLIC_CURSOR_INVALID");
    const index = ordered.findIndex((record) => record.payload.publicId === cursor.publicId && record.payload.publishedAt === cursor.publishedAt); if (index < 0) throw new PublicReadError("PUBLIC_CURSOR_INVALID"); start = index + 1;
  }
  const records = ordered.slice(start, start + limit); const last = records.at(-1);
  return Object.freeze({ records, limit, nextCursor: start + records.length < ordered.length && last ? encodePublicBilingualCursor({ generationHash: snapshot.generationHash, publishedAt: last.payload.publishedAt, publicId: last.payload.publicId }) : null });
}
