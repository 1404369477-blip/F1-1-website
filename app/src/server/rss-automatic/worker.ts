import { inMemoryRssAutomaticCursorStore, type RssAutomaticCursorStore, type RssAutomaticCursor } from "./cursor.ts";
import type { DatabaseSync } from "node:sqlite";
import type { SqliteInternalOperationGateway } from "../internal-operation/gateway.ts";
import type { SqliteGatewayMutationPort } from "../internal-operation/mutation-port.ts";
import { assertPhaseAllowsExternal, readPhaseSnapshot } from "../internal-operation/phase.ts";
import { RSS_AUTO_PIPELINE_SOURCE_IDS } from "../review-real/automatic-pipeline.ts";
import type { ReviewRealRepository } from "../review-real/repository.ts";
import type { RefinementReceipt } from "../rss/refinement.ts";
import { assertRssAutomaticTarget, issueRssAutomaticFences } from "./admission.ts";
import type { AutomaticTarget } from "./contract.ts";

export type RssAutomaticCycleReceipt = Readonly<{
  schemaVersion:"rss-automatic-cycle-v1"; status:"idle"|"processed"|"blocked"; reasonCode:string|null;
  considered:number; refined:number; approved:number; published:number; deliveryId:string|null;
  items:readonly Readonly<{candidateId:string;sourceRevision:number;status:string;reasonCode:string|null}>[];
}>;
export async function runRssAutomaticCycle(input: Readonly<{
  database:DatabaseSync; gateway:SqliteInternalOperationGateway; supervisorPort:SqliteGatewayMutationPort;
  reviewer:ReviewRealRepository; publisher:ReviewRealRepository;
  refine:(target:AutomaticTarget)=>Promise<RefinementReceipt>;
  cutoffIso:string; limit?:number; now?:()=>Date; cursorStore?:RssAutomaticCursorStore;
}>):Promise<RssAutomaticCycleReceipt> {
  const receipt = { schemaVersion:"rss-automatic-cycle-v1" as const,status:"idle" as "idle"|"processed"|"blocked",reasonCode:null as string|null,
    considered:0,refined:0,approved:0,published:0,deliveryId:null as string|null,items:[] as Array<{candidateId:string;sourceRevision:number;status:string;reasonCode:string|null}> };
  const code = (error:unknown) => error instanceof Error && /^[A-Z0-9_:-]{1,180}$/.test(error.message) ? error.message : "RSS_AUTO_OPERATION_FAILED";
  try {
    const limit = input.limit ?? 5;
    if (!Number.isSafeInteger(limit) || limit<1 || limit>20 || !Number.isFinite(Date.parse(input.cutoffIso))) throw new Error("RSS_AUTO_CYCLE_INPUT_INVALID");
    if (!input.database.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='rss_automatic_fence_current_v1'").get()) throw new Error("RSS_AUTO_SCHEMA_REQUIRED");
    assertPhaseAllowsExternal(readPhaseSnapshot(input.database),"model_https");
    const cursorStore=input.cursorStore??inMemoryRssAutomaticCursorStore(input.database);
    let cursor=cursorStore.read();
    if(cursor?.cutoffIso!==input.cutoffIso)cursor=null;
    const selection=`SELECT c.candidate_id,c.source_revision,c.source_payload_hash,c.first_seen_at FROM pending_review_candidate c
      WHERE c.source_id IN (${RSS_AUTO_PIPELINE_SOURCE_IDS.map(()=>"?").join(",")}) AND c.first_seen_at>=?
      AND (c.review_status IN ('pending_review','approved') OR (c.review_status='published' AND NOT EXISTS(
        SELECT 1 FROM review_bundle b WHERE b.candidate_id=c.candidate_id AND b.source_revision=c.source_revision AND b.source_payload_hash=c.source_payload_hash
        AND b.bundle_revision=(SELECT MAX(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=c.candidate_id))))`;
    const freshRound=():RssAutomaticCursor|null=>{
      const last=input.database.prepare(`${selection} ORDER BY c.first_seen_at DESC,c.candidate_id DESC LIMIT 1`).get(...RSS_AUTO_PIPELINE_SOURCE_IDS,input.cutoffIso);
      return last?{schemaVersion:"rss-automatic-cursor-v1",cutoffIso:input.cutoffIso,after:null,upperBound:{firstSeenAt:String(last.first_seen_at),candidateId:String(last.candidate_id)}}:null;
    };
    cursor??=freshRound();
    if(!cursor)return Object.freeze(receipt);
    const readBatch=(position:RssAutomaticCursor)=>input.database.prepare(`${selection}
      AND (c.first_seen_at<? OR (c.first_seen_at=? AND c.candidate_id<=?))
      ${position.after?"AND (c.first_seen_at>? OR (c.first_seen_at=? AND c.candidate_id>?))":""}
      ORDER BY c.first_seen_at ASC,c.candidate_id ASC LIMIT ?`).all(...RSS_AUTO_PIPELINE_SOURCE_IDS,input.cutoffIso,
        position.upperBound.firstSeenAt,position.upperBound.firstSeenAt,position.upperBound.candidateId,
        ...(position.after?[position.after.firstSeenAt,position.after.firstSeenAt,position.after.candidateId]:[]),limit) as Array<Record<string,unknown>>;
    let rows=readBatch(cursor);
    if(rows.length===0){cursor=freshRound();if(!cursor)return Object.freeze(receipt);rows=readBatch(cursor);}
    for (const row of rows) {
      const target = {candidateId:String(row.candidate_id),sourceRevision:Number(row.source_revision),inputContentHash:String(row.source_payload_hash)};
      receipt.considered++;
      cursor={...cursor,after:{firstSeenAt:String(row.first_seen_at),candidateId:target.candidateId}};
      cursorStore.write(cursor);
      try {
        assertRssAutomaticTarget(input.database,target,input.cutoffIso,(input.now ?? (()=>new Date()))());
        issueRssAutomaticFences({...input,target});
        const refined = await input.refine(target);
        if (refined.status === "blocked") throw new Error(refined.reasonCode ?? "RSS_AUTO_REFINEMENT_BLOCKED");
        receipt.refined += refined.status === "generated" ? 1 : 0;
        assertRssAutomaticTarget(input.database,target,input.cutoffIso,(input.now ?? (()=>new Date()))());
        let detail = input.reviewer.detail(target.candidateId);
        if (detail.reviewState === "pending_review" || detail.reviewState === "source_updated") {
          input.reviewer.reviewAutomaticCandidate(target); receipt.approved++;
          detail = input.reviewer.detail(target.candidateId);
        }
        if (detail.reviewState !== "approved_waiting_publish" || !detail.latestBundle) throw new Error("AUTO_PUBLISH_NOT_READY");
        const publication = input.database.prepare(`SELECT p.publication_id FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id
          WHERE b.bundle_id=? AND b.source_revision=? AND b.source_payload_hash=? AND p.publication_status='queued'`).get(detail.latestBundle.id,target.sourceRevision,target.inputContentHash) as Record<string,unknown>|undefined;
        if (!publication) throw new Error("RSS_AUTO_PUBLICATION_STALE");
        issueRssAutomaticFences({...input,target,publicationId:String(publication.publication_id)});
        const published = input.publisher.publishAutomaticCandidate(target);
        if (published.kind !== "publish") throw new Error("RSS_AUTO_RESULT_INVALID");
        receipt.published++; receipt.deliveryId=published.deliveryId;
        receipt.items.push({candidateId:target.candidateId,sourceRevision:target.sourceRevision,status:"delivery_pending",reasonCode:null});
        // One publication per generation. Existing sender owns delivery; the
        // next cycle observes its terminal result before another generation.
        break;
      } catch (error) {
        receipt.items.push({candidateId:target.candidateId,sourceRevision:target.sourceRevision,status:"blocked",reasonCode:code(error)});
        if (code(error)==="PUBLICATION_RECONCILE_WAIT") break;
      }
    }
    receipt.status = receipt.published || receipt.approved || receipt.refined ? "processed" : receipt.items.length ? "blocked" : "idle";
    receipt.reasonCode = receipt.status === "blocked" ? receipt.items[0]?.reasonCode ?? "RSS_AUTO_BLOCKED" : null;
  } catch (error) { receipt.status="blocked";receipt.reasonCode=code(error); }
  return Object.freeze(receipt);
}
