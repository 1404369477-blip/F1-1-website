// Synthetic signed content and artifact double; all SQL ownership, permits,
// model-attempt accounting and publication/outbox writes use the real gateway.
import {xPageAdmissionFixture} from "./x-page-admission.ts";
import {ReviewRealRepository} from "../../server/review-real/repository.ts";
import {createXPageModelGateway} from "../../server/x-page/model-transport.ts";
import {refineOneXCandidate} from "../../server/x-page/refinement.ts";
import type {XPageAutomaticTarget} from "../../server/x-page/content-authority.ts";
import type {GatewayMutationTransactionInput,GatewayMutationPort} from "../../server/internal-operation/mutation-port.ts";
import {createHash,generateKeyPairSync} from "node:crypto";
import {join} from "node:path";
import {ProjectionReceiver} from "../../server/review-real/projection.ts";
import {ProjectionSender} from "../../server/review-real/sender.ts";
import {prepareXPageAutomaticDelivery} from "../../server/x-page/delivery-authority.ts";

export async function xPageAutomaticFixture(options:Readonly<{repost?:boolean;text?:string;fetcher?:typeof fetch}>={}) {
  const e=await xPageAdmissionFixture();
  e.admit();if(options.repost)e.admit("x_mclarenf1");e.live();
  const capture=e.capture({text:options.text??"Synthetic complete F1 body. ".repeat(80),observedOn:options.repost?"mclarenf1":"f1"});
  const imported=e.importCapture(capture),target={candidateId:imported.candidateId,sourceRevision:imported.sourceRevision,inputContentHash:imported.sourceVersionHash};
  const reviewer=new ReviewRealRepository(e.database,e.now,e.port("automatic_reviewer")),publisher=new ReviewRealRepository(e.database,e.now,e.port("automatic_publisher")),sender=new ReviewRealRepository(e.database,e.now,e.port("projection_sender"));
  let calls=0;
  const model=createXPageModelGateway({externalPort:e.port("bilingual_refiner"),privateDir:e.root,fetcher:async(...args)=>{
    calls++;
    if(options.fetcher)return options.fetcher(...args);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"车队分享技术进展",summaryZh:"车队通过原帖介绍了近期的赛车技术进展。",keyPointsZh:["完整正文用于整理"]})}}],usage:{prompt_tokens:32,completion_tokens:24}}),{status:200});
  }});
  const refine=(value:XPageAutomaticTarget=target)=>refineOneXCandidate({database:e.database,target:value,trust:e.trust,receiptLedger:e.receiptLedger,evidencePort:e.evidencePort,
    mutationPort:e.port("bilingual_refiner"),...model,budgetAccountId:"acct-rss",now:e.now});
  return {...e,rssTarget:e.target,initialCapture:capture,target,reviewer,publisher,sender,supervisorPort:e.port("system_supervisor"),refine,get modelCalls(){return calls;}};
}

export function xPageProjectionSender(e:Awaited<ReturnType<typeof xPageAutomaticFixture>>,options:Readonly<{unknown?:boolean}>={}) {
  e.fixtureMutation(database=>{
    database.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();
    database.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)")
      .run(createHash("sha256").update("127.0.0.1:3102/internal/projections").digest("hex"),"0".repeat(64),"0".repeat(64));
  });
  const keys=generateKeyPairSync("ed25519"),root=join(e.root,"x-public-snapshot"),signingKeyId="synthetic-x-key";
  const receiver=new ProjectionReceiver({root,signingKeyId,publicKey:keys.publicKey,now:()=>e.now().getTime()});
  const senderPort=e.port("projection_sender"),reconciler=e.port("reconciler");let posts=0,gets=0;
  const errors:string[]=[],transaction=senderPort.runTransaction.bind(senderPort);
  const diagnosticPort=new Proxy(senderPort,{get(target,property){
    if(property==="runTransaction")return <T>(request:GatewayMutationTransactionInput,callback:Parameters<NonNullable<GatewayMutationPort["runTransaction"]>>[1])=>{
      try{return transaction(request,callback) as T;}catch(error){errors.push(error instanceof Error?error.stack??error.message:String(error));throw error;}
    };
    const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
  }});
  const sender=new ProjectionSender({repository:new ReviewRealRepository(e.database,e.now,diagnosticPort),signingKeyId,privateKey:keys.privateKey,actorRef:"synthetic-x-sender",
    prepareDeliveryAuthority:()=>{prepareXPageAutomaticDelivery(e);},externalAttempt:senderPort.runExternal.bind(senderPort),externalReconcile:reconciler.runProjectionReconcile.bind(reconciler),
    transport:{post:async value=>{posts++;const body=receiver.receive(value);return options.unknown?{kind:"unknown"}:{kind:"response",status:200,body};},
      getReceipt:async id=>{gets++;return {kind:"response",status:200,body:receiver.getReceipt(id)};}}});
  return {sender,receiver,root,signingKeyId,publicKey:keys.publicKey,errors,counts:()=>({posts,gets})};
}
