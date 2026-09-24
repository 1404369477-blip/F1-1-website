import type {DatabaseSync} from "node:sqlite";
import type {SqliteInternalOperationGateway} from "../internal-operation/gateway.ts";
import type {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import {prepareRssAutomaticDelivery} from "../rss-automatic/delivery-authority.ts";
import {prepareXPageAutomaticDelivery} from "../x-page/delivery-authority.ts";

/** Match the existing preparation order globally, before choosing a source lane.
 * Each concrete preparer revalidates this committed delivery and its full proof. */
export function nextAutomaticDelivery(database:DatabaseSync):Readonly<{deliveryId:string;kind:"rss"|"x_page"|"manual"}>|null {
  const next=database.prepare(`SELECT delivery_id,publication_id FROM projection_outbox
    WHERE status IN ('leased','reconcile_wait','pending','retryable_failed')
    ORDER BY CASE status WHEN 'leased' THEN 0 WHEN 'reconcile_wait' THEN 1 ELSE 2 END,created_at,delivery_id LIMIT 1`).get();
  if(!next)return null;
  const source=database.prepare(`SELECT c.candidate_id,c.source_id,s.source_kind FROM publication p
    JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id
    JOIN source_registry_v1 s ON s.source_id=c.source_id WHERE p.publication_id=?`).get(next.publication_id);
  const published=database.prepare(`SELECT op.policy_id,op.owner_process,op.operation_kind,op.state,op.candidate_id,op.source_id
    FROM internal_operation_audit a JOIN internal_operation op ON op.operation_id=a.operation_id
    WHERE a.event_type='operation_succeeded' AND json_extract(a.event_json,'$.automaticResult.kind')='publish'
      AND json_extract(a.event_json,'$.automaticResult.deliveryId')=?`).all(next.delivery_id);
  if(published.length===0){
    if(source?.source_kind==="x_page")throw new Error("AUTOMATIC_DELIVERY_PUBLISH_PROOF_REQUIRED");
    return {deliveryId:String(next.delivery_id),kind:"manual"};
  }
  const op=published[0];
  if(published.length!==1 || !source || op.owner_process!=="automatic_publisher" || op.operation_kind!=="publish" || op.state!=="succeeded"
    || op.candidate_id!==source.candidate_id || op.source_id!==source.source_id)throw new Error("AUTOMATIC_DELIVERY_PUBLISH_BINDING_INVALID");
  const kind=source.source_kind==="x_page" && op.policy_id==="p-x-page-auto-publish-live" ? "x_page"
    : source.source_kind==="rss" && ["p-publish-auto-live","p-publish-auto-backlog"].includes(String(op.policy_id)) ? "rss" : null;
  if(kind===null)throw new Error("AUTOMATIC_DELIVERY_SOURCE_POLICY_MISMATCH");
  return {deliveryId:String(next.delivery_id),kind};
}
export function prepareAutomaticDelivery(input:Readonly<{database:DatabaseSync;gateway:SqliteInternalOperationGateway;
  rssSupervisorPort:SqliteGatewayMutationPort;xPageSupervisorPort?:SqliteGatewayMutationPort;now?:()=>Date}>):Readonly<{issued:number;reused:number}> {
  const head=nextAutomaticDelivery(input.database);
  if(!head || head.kind==="manual")return {issued:0,reused:0};
  if(head.kind==="rss")return prepareRssAutomaticDelivery({...input,supervisorPort:input.rssSupervisorPort});
  if(!input.xPageSupervisorPort)throw new Error("X_PAGE_DELIVERY_RUNTIME_REQUIRED");
  return prepareXPageAutomaticDelivery({...input,supervisorPort:input.xPageSupervisorPort});
}
