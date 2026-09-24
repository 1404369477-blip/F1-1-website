import { z } from "zod";
import type {DatabaseSync} from "node:sqlite";
import {rssItemPayloadHash} from "../rss/types.ts";

export const AutomaticTargetSchema = z.object({
  candidateId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/),
  sourceRevision: z.number().int().positive(),
  inputContentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type AutomaticTarget = z.infer<typeof AutomaticTargetSchema>;
const shared = {
  schemaVersion: z.literal("automatic-mutation-result-v1"),
  operationId: z.string(), candidateId: z.string(), sourceRevision: z.number().int().positive(),
  inputContentHash: z.string().regex(/^[0-9a-f]{64}$/), publicationId: z.string(), publicId: z.string(),
};
export const AutomaticMutationResultSchema = z.discriminatedUnion("kind", [
  z.object({ ...shared, kind: z.literal("review"), status: z.literal("approved"), bundleId: z.string(), bundleHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ ...shared, kind: z.literal("publish"), status: z.literal("delivery_pending"), deliveryId: z.string(), generation: z.number().int().positive() }).strict(),
]);
export type AutomaticMutationResult = z.infer<typeof AutomaticMutationResultSchema>;

/** Recompute the parser's existing content commitment, including image data.
 * This rejects historical partial writes without inventing a completion flag. */
export function hasCompleteRssAutomaticPayload(database:DatabaseSync,target:AutomaticTarget):boolean {
  const row=database.prepare("SELECT * FROM pending_review_candidate WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?").get(target.candidateId,target.sourceRevision,target.inputContentHash);
  if(!row)return false;
  const media=database.prepare("SELECT media_url,media_type,declared_bytes FROM rss_media_candidate WHERE candidate_id=? AND source_revision=? AND source_payload_hash=?").get(target.candidateId,target.sourceRevision,target.inputContentHash);
  const hash=rssItemPayloadHash({externalId:String(row.external_id),canonicalUrl:String(row.canonical_url),title:String(row.title),excerpt:String(row.excerpt),
    author:row.author===null?null:String(row.author),publishedAt:String(row.published_at),media:media?{url:String(media.media_url),mimeType:String(media.media_type) as "image/jpeg"|"image/png"|"image/webp",declaredBytes:Number(media.declared_bytes)}:null});
  return hash===target.inputContentHash;
}

/** Preserve the current human-reviewed bundle. Historical automated rows used
 * the two legacy actor/id pairs below; genuine internal owners use no HTTP row. */
export function hasCurrentManualReview(database: import("node:sqlite").DatabaseSync, target: AutomaticTarget): boolean {
  return database.prepare(`SELECT 1 FROM review_bundle b
    JOIN admin_operation legacy ON json_extract(legacy.response_json,'$.operation.bundleId')=b.bundle_id
    JOIN audit_event audit ON audit.operation_id=legacy.operation_id
    WHERE b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=?
    AND b.bundle_revision=(SELECT MAX(bundle_revision) FROM review_bundle WHERE candidate_id=b.candidate_id)
    AND NOT ((legacy.operation_id LIKE 'auto-review-%' AND audit.actor_ref='system-auto-review-v1')
      OR (legacy.operation_id LIKE 'auto-publish-%' AND audit.actor_ref='system-auto-publish-v1')) LIMIT 1`
  ).get(target.candidateId,target.sourceRevision,target.inputContentHash)!==undefined;
}
