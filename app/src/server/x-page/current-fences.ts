import type { DatabaseSync } from "node:sqlite";

import type { XPageRefinementTarget } from "./trusted-importer.ts";

export const X_PAGE_AUTOMATIC_FENCE_REASON = "X_PAGE_AUTOMATIC_CURRENT_V1";
export const X_PAGE_COMMITTED_DELIVERY_FENCE_REASON = "X_PAGE_AUTOMATIC_COMMITTED_DELIVERY_V1";

/** Denials remain effective until a later, committed control receipt explicitly
 * clears that exact scope/kind in the current epochs. Automatic eligibility and
 * delivery renewals cannot clear a denial, and denial expiry is not a release.
 * Equal timestamps fail closed. Receipt history is never rewritten. */
export function assertXPageCurrentFences(database: DatabaseSync, input: Readonly<{
  target: XPageRefinementTarget;
  sourceIds: readonly string[];
  publicationId?: string | null;
  now: Date;
  reasonCode?: string;
}>): void {
  if (!input.sourceIds.length || !Number.isFinite(input.now.getTime())) throw new Error("X_PAGE_FENCE_SCOPE_INVALID");
  const control = database.prepare("SELECT policy_epoch,recovery_epoch,writer_epoch FROM internal_control WHERE singleton_id=1").get();
  if (!control) throw new Error("X_PAGE_AUTOMATIC_CONTROL_CLOSED");
  const blocked = database.prepare(`SELECT 1 FROM generic_fence_receipt f
    WHERE f.state<>'clear' AND f.policy_epoch=? AND f.recovery_epoch=? AND f.writer_epoch=?
      AND ((f.scope_kind='global' AND f.scope_id IS NULL)
        OR (f.scope_kind='source' AND f.scope_id IN (SELECT value FROM json_each(?)))
        OR (f.scope_kind='candidate' AND f.scope_id=?)
        OR (f.scope_kind='publication' AND (f.scope_id=? OR EXISTS(
          SELECT 1 FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id
          WHERE p.publication_id=f.scope_id AND b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=?
            AND b.bundle_revision=(SELECT MAX(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=b.candidate_id)))))
      AND NOT EXISTS(SELECT 1 FROM generic_fence_receipt released
        JOIN internal_operation issuer ON issuer.operation_id=released.issued_by_operation_id AND issuer.state='succeeded'
        WHERE released.scope_kind=f.scope_kind AND released.scope_id IS f.scope_id AND released.fence_kind=f.fence_kind
          AND released.policy_epoch=f.policy_epoch AND released.recovery_epoch=f.recovery_epoch AND released.writer_epoch=f.writer_epoch
          AND released.state='clear' AND released.observed_at>f.observed_at AND released.observed_at<=?
          AND released.reason_code NOT IN (?,?, 'RSS_AUTOMATIC_CURRENT_V1','RSS_AUTOMATIC_COMMITTED_DELIVERY_V1')) LIMIT 1`)
    .get(control.policy_epoch, control.recovery_epoch, control.writer_epoch, JSON.stringify(input.sourceIds), input.target.candidateId,
      input.publicationId ?? null, input.target.candidateId, input.target.sourceRevision, input.target.inputContentHash,
      input.now.toISOString(), X_PAGE_AUTOMATIC_FENCE_REASON, X_PAGE_COMMITTED_DELIVERY_FENCE_REASON);
  if (blocked) throw new Error(input.reasonCode ?? "X_PAGE_AUTOMATIC_FENCE_REVOKED");
}

/** Called by the existing gateway precheck/transaction/postcheck boundary. The
 * control writer must still be able to record denials and explicit releases;
 * automatic clear issuers guard themselves before every insert. */
export function assertXPageOperationFences(database: DatabaseSync, operationId: string, now: Date): void {
  const operation = database.prepare(`SELECT policy_id,candidate_id,publication_id,expected_entity_version,expected_entity_hash
    FROM internal_operation WHERE operation_id=?`).get(operationId);
  if (!operation || !["p-x-page-refine-live", "p-x-page-refine-store-live", "p-x-page-auto-review-live", "p-x-page-auto-publish-live"].includes(String(operation.policy_id))) return;
  const sources = database.prepare("SELECT entity_id FROM operation_entity_binding WHERE operation_id=? AND entity_kind='source'").all(operationId);
  assertXPageCurrentFences(database, { target: { candidateId: String(operation.candidate_id), sourceRevision: Number(operation.expected_entity_version),
    inputContentHash: String(operation.expected_entity_hash) }, sourceIds: sources.map(source => String(source.entity_id)),
    publicationId: operation.publication_id === null ? null : String(operation.publication_id), now });
}
