import type {DatabaseSync} from "node:sqlite";
import type {SqliteInternalOperationGateway} from "../internal-operation/gateway.ts";
import type {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import type {ReviewRealRepository} from "../review-real/repository.ts";
import {X_PAGE_HANDLES} from "./normalize.ts";
import type {XPageRefinementReceipt} from "./refinement.ts";
import {issueXPageAutomaticFences,readXPageAutomaticContent,readXPageAutomaticControl,type XPageAutomaticTarget} from "./content-authority.ts";

type Position=Readonly<{firstSeenAt:string;candidateId:string}>;
export type XPageAutomaticCursor=Readonly<{cutoffIso:string;after:Position|null;upperBound:Position}>;
export type XPageAutomaticCursorStore=Readonly<{read:()=>XPageAutomaticCursor|null;write:(cursor:XPageAutomaticCursor)=>void}>;
const cursors=new WeakMap<DatabaseSync,XPageAutomaticCursorStore>();
function inMemoryCursor(database:DatabaseSync):XPageAutomaticCursorStore {
  let store=cursors.get(database);if(store)return store;
  let cursor:XPageAutomaticCursor|null=null;store={read:()=>cursor,write:value=>{cursor=value;}};cursors.set(database,store);return store;
}
export type XPageAutomaticCycleReceipt=Readonly<{
  schemaVersion:"x-page-automatic-cycle-v1";status:"idle"|"processed"|"blocked";reasonCode:string|null;
  considered:number;refined:number;approved:number;published:number;deliveryId:string|null;
  items:readonly Readonly<{candidateId:string;sourceRevision:number;status:"delivery_pending"|"blocked";reasonCode:string|null}>[];
}>;

/** Local orchestration only. The injected refiner must use the trusted model
 * gateway. This loop never sends a projection; the existing global outbox and
 * sender own the one next generation across RSS and X. */
export async function runXPageAutomaticCycle(input:Readonly<{
  database:DatabaseSync;gateway:SqliteInternalOperationGateway;supervisorPort:SqliteGatewayMutationPort;
  reviewer:Pick<ReviewRealRepository,"reviewXPageAutomaticCandidate">;publisher:Pick<ReviewRealRepository,"publishXPageAutomaticCandidate">;
  refine:(target:XPageAutomaticTarget)=>Promise<XPageRefinementReceipt>;cutoffIso:string;limit?:number;now?:()=>Date;cursorStore?:XPageAutomaticCursorStore;
}>):Promise<XPageAutomaticCycleReceipt> {
  const receipt={schemaVersion:"x-page-automatic-cycle-v1" as const,status:"idle" as XPageAutomaticCycleReceipt["status"],reasonCode:null as string|null,
    considered:0,refined:0,approved:0,published:0,deliveryId:null as string|null,items:[] as Array<XPageAutomaticCycleReceipt["items"][number]>};
  const code=(error:unknown)=>error instanceof Error&&/^[A-Z0-9_:-]{1,180}$/.test(error.message)?error.message:"X_PAGE_AUTO_OPERATION_FAILED";
  const now=input.now??(()=>new Date());
  try {
    const limit=input.limit??5;
    if(!Number.isSafeInteger(limit)||limit<1||limit>20||!Number.isFinite(Date.parse(input.cutoffIso)))throw new Error("X_PAGE_AUTO_CYCLE_INPUT_INVALID");
    if(!input.database.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='x_page_automatic_fence_current_v1'").get())throw new Error("X_PAGE_AUTO_SCHEMA_REQUIRED");
    readXPageAutomaticControl(input.database);
    const sourceIds=X_PAGE_HANDLES.map(handle=>`x_${handle.toLowerCase()}`),store=input.cursorStore??inMemoryCursor(input.database);
    let cursor=store.read();if(cursor?.cutoffIso!==input.cutoffIso)cursor=null;
    const selection=`SELECT c.candidate_id,c.source_revision,c.source_payload_hash,c.first_seen_at FROM pending_review_candidate c
      WHERE c.source_id IN (${sourceIds.map(()=>"?").join(",")}) AND c.first_seen_at>=?
      AND EXISTS(SELECT 1 FROM x_page_candidate_capture_v1 capture WHERE capture.candidate_id=c.candidate_id AND capture.source_revision=c.source_revision AND capture.source_version_hash=c.source_payload_hash)
      AND (c.review_status IN ('pending_review','approved') OR (c.review_status='published' AND NOT EXISTS(
        SELECT 1 FROM review_bundle b WHERE b.candidate_id=c.candidate_id AND b.source_revision=c.source_revision AND b.source_payload_hash=c.source_payload_hash
          AND b.bundle_revision=(SELECT MAX(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=c.candidate_id))))`;
    const freshRound=():XPageAutomaticCursor|null=>{
      const last=input.database.prepare(`${selection} ORDER BY c.first_seen_at DESC,c.candidate_id DESC LIMIT 1`).get(...sourceIds,input.cutoffIso);
      return last?{cutoffIso:input.cutoffIso,after:null,upperBound:{firstSeenAt:String(last.first_seen_at),candidateId:String(last.candidate_id)}}:null;
    };
    cursor??=freshRound();if(!cursor)return Object.freeze(receipt);
    const readBatch=(position:XPageAutomaticCursor)=>input.database.prepare(`${selection}
      AND (c.first_seen_at<? OR (c.first_seen_at=? AND c.candidate_id<=?)) ${position.after?"AND (c.first_seen_at>? OR (c.first_seen_at=? AND c.candidate_id>?))":""}
      ORDER BY c.first_seen_at,c.candidate_id LIMIT ?`).all(...sourceIds,input.cutoffIso,position.upperBound.firstSeenAt,position.upperBound.firstSeenAt,position.upperBound.candidateId,
        ...(position.after?[position.after.firstSeenAt,position.after.firstSeenAt,position.after.candidateId]:[]),limit);
    let rows=readBatch(cursor);if(rows.length===0){cursor=freshRound();if(!cursor)return Object.freeze(receipt);rows=readBatch(cursor);}
    for(const row of rows){
      const target={candidateId:String(row.candidate_id),sourceRevision:Number(row.source_revision),inputContentHash:String(row.source_payload_hash)};
      receipt.considered++;cursor={...cursor,after:{firstSeenAt:String(row.first_seen_at),candidateId:target.candidateId}};store.write(cursor);
      try {
        readXPageAutomaticContent(input.database,target,now(),false);
        issueXPageAutomaticFences({...input,target,now});
        const refined=await input.refine(target);if(refined.status==="blocked")throw new Error(refined.reasonCode??"X_PAGE_AUTO_REFINEMENT_BLOCKED");
        receipt.refined+=refined.status==="generated"?1:0;
        const current=readXPageAutomaticContent(input.database,target,now());
        if(current.candidate.review_status==="pending_review"||current.candidate.review_status==="published"){
          const reviewed=input.reviewer.reviewXPageAutomaticCandidate(target);if(reviewed.kind!=="review")throw new Error("X_PAGE_AUTO_RESULT_INVALID");receipt.approved++;
        }
        const publication=input.database.prepare(`SELECT p.publication_id FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id
          WHERE b.candidate_id=? AND b.source_revision=? AND b.source_payload_hash=? AND p.publication_status='queued'
            AND b.bundle_revision=(SELECT MAX(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=b.candidate_id)`)
          .get(target.candidateId,target.sourceRevision,target.inputContentHash);
        if(!publication)throw new Error("X_PAGE_AUTO_PUBLICATION_STALE");
        issueXPageAutomaticFences({...input,target,publicationId:String(publication.publication_id),now});
        const published=input.publisher.publishXPageAutomaticCandidate(target);if(published.kind!=="publish")throw new Error("X_PAGE_AUTO_RESULT_INVALID");
        receipt.published++;receipt.deliveryId=published.deliveryId;
        receipt.items.push({candidateId:target.candidateId,sourceRevision:target.sourceRevision,status:"delivery_pending",reasonCode:null});break;
      }catch(error){receipt.items.push({candidateId:target.candidateId,sourceRevision:target.sourceRevision,status:"blocked",reasonCode:code(error)});if(code(error)==="PUBLICATION_RECONCILE_WAIT")break;}
    }
    receipt.status=receipt.published||receipt.approved||receipt.refined?"processed":receipt.items.length?"blocked":"idle";
    receipt.reasonCode=receipt.status==="blocked"?receipt.items[0]?.reasonCode??"X_PAGE_AUTO_BLOCKED":null;
  }catch(error){receipt.status="blocked";receipt.reasonCode=code(error);}
  return Object.freeze(receipt);
}
