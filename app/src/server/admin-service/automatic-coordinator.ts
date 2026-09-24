import {join,resolve} from "node:path";
import type {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {canonicalJsonV1} from "../internal-operation/gateway.ts";
import {readPrivateFile,atomicWritePrivateFile} from "../rss/private-credential-file.ts";

type Lane="rss"|"x_page";
type Cycle=Readonly<{status:"idle"|"blocked"|"processed";reasonCode:string|null;published:number}>;
const Order=z.object({schemaVersion:z.literal("automatic-processing-order-v1"),schemaSha256:z.string().regex(/^[a-f0-9]{64}$/),
  rssCutoffIso:z.iso.datetime({precision:3}),xPageCutoffIso:z.iso.datetime({precision:3}),next:z.enum(["rss","x_page"])}).strict();
export type AutomaticCoordinatorReceipt=Readonly<{schemaVersion:"automatic-coordinator-cycle-v1";status:"idle"|"blocked"|"processed";
  reasonCode:string|null;cycles:readonly Readonly<{lane:Lane;receipt:Cycle}>[]}>;
/** One global generation, fair durable source order, and draining close. The two
 * workers retain distinct candidate cursors and all normal gateway checks. */
export function createAutomaticCoordinator(input:Readonly<{database:DatabaseSync;privateDir:string;schemaSha256:string;
  rssCutoffIso:string;xPageCutoffIso:string;rss():Promise<Cycle>;xPage():Promise<Cycle>;closeResources():void}>):Readonly<{
    tick():Promise<AutomaticCoordinatorReceipt>;close():Promise<void>
  }> {
  const path=join(resolve(input.privateDir),"automatic-processing-order.json");
  const identity={schemaVersion:"automatic-processing-order-v1" as const,schemaSha256:input.schemaSha256,rssCutoffIso:input.rssCutoffIso,xPageCutoffIso:input.xPageCutoffIso};
  let pending:Promise<AutomaticCoordinatorReceipt>|null=null,closing=false,closed:Promise<void>|undefined;
  const run=async():Promise<AutomaticCoordinatorReceipt>=>{
    const cycles:Array<{lane:Lane;receipt:Cycle}>=[];
    if(input.database.prepare("SELECT 1 FROM projection_outbox WHERE status IN ('leased','reconcile_wait','pending','retryable_failed') LIMIT 1").get())
      return {schemaVersion:"automatic-coordinator-cycle-v1",status:"blocked",reasonCode:"PUBLICATION_RECONCILE_WAIT",cycles};
    const file=readPrivateFile(path,4096),saved=file===null?null:Order.parse(JSON.parse(file.text));
    const first=saved && saved.schemaSha256===identity.schemaSha256 && saved.rssCutoffIso===identity.rssCutoffIso && saved.xPageCutoffIso===identity.xPageCutoffIso?saved.next:"rss";
    for(const lane of [first,first==="rss"?"x_page":"rss"] as const){
      if(closing)break;
      const current=readPrivateFile(path,4096);
      atomicWritePrivateFile(path,canonicalJsonV1(Order.parse({...identity,next:lane==="rss"?"x_page":"rss"})),current?.identity??null,4096);
      const receipt=await (lane==="rss"?input.rss():input.xPage());cycles.push({lane,receipt});
      if(receipt.published>0 || receipt.reasonCode==="PUBLICATION_RECONCILE_WAIT")break;
    }
    const status=cycles.some(item=>item.receipt.status==="processed")?"processed":cycles.some(item=>item.receipt.status==="blocked")?"blocked":"idle";
    return {schemaVersion:"automatic-coordinator-cycle-v1",status,reasonCode:status==="blocked"?cycles.find(item=>item.receipt.reasonCode!==null)?.receipt.reasonCode??null:null,cycles};
  };
  return Object.freeze({tick:()=>{
    if(closing)return Promise.reject(new Error("ADMIN_AUTOMATIC_RUNTIME_CLOSED"));
    pending??=run().finally(()=>{pending=null;});return pending;
  },close:()=>{
    if(closed)return closed;closing=true;
    closed=Promise.resolve(pending).then(()=>undefined,()=>undefined).then(()=>{input.closeResources();});return closed;
  }});
}
