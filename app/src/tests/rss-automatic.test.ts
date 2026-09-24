import {createHash,generateKeyPairSync} from "node:crypto";
import {backup,DatabaseSync} from "node:sqlite";
import {chmodSync,mkdtempSync,realpathSync,rmSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,test,vi} from "vitest";
import {xPageSchema12} from "./helpers/x-page-database.ts";
import {applyRssAutomaticMigration,assertRssAutomaticSchema} from "../server/rss-automatic/migration.ts";
import {RSS_AUTOMATIC_SCHEMA_SHA256} from "../server/rss-automatic/schema-identity.ts";
import {assertRssAutomaticTarget,issueRssAutomaticFences} from "../server/rss-automatic/admission.ts";
import {prepareRssAutomaticDelivery} from "../server/rss-automatic/delivery-authority.ts";
import {createRssAutomaticCursorStore} from "../server/rss-automatic/cursor.ts";
import {runRssAutomaticCycle} from "../server/rss-automatic/worker.ts";
import {ProjectionSender} from "../server/review-real/sender.ts";
import {ProjectionReceiver} from "../server/review-real/projection.ts";
import {ReviewRealRepository} from "../server/review-real/repository.ts";
import {refineOneCandidate,DEEPSEEK_PROMPT_SHA256} from "../server/rss/refinement.ts";
import {SqliteInternalOperationGateway,type OwnerProcess} from "../server/internal-operation/gateway.ts";
import {SqliteGatewayMutationPort} from "../server/internal-operation/mutation-port.ts";
import {persistOwnerSupervisorHandoff} from "../server/internal-operation/owner-supervisor.ts";
import {inspectExistingPrivateDatabase,openExistingSafeDatabase} from "../server/db/database.ts";
const ZERO="0".repeat(64),NOW="2026-09-07T00:00:00.000Z",CUTOFF="2026-09-05T02:30:00.000Z";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const payloadHash=(title="F1 test news",externalId="synthetic-guid",url="https://www.motorsport.com/f1/news/synthetic/",media:unknown=null)=>digest(JSON.stringify([externalId,url,title,"F1 test summary","Synthetic",NOW,media]));
const target={candidateId:"rss-auto-synthetic",sourceRevision:3,inputContentHash:payloadHash()};
const NEXT_HASH=payloadHash("F1 updated news");
const cleanups:Array<()=>void>=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
// Isolated fixture construction; all production triggers are restored before gateway admission.
function seed(database:DatabaseSync,callback:()=>void) {
 const triggers=database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all() as Array<{name:string;sql:string}>;
 for(const row of triggers)database.exec(`DROP TRIGGER "${row.name}"`);
 try{callback();}finally{for(const row of triggers)database.exec(row.sql);}
}
async function ready(withDraft=true,stopped=false) {
 let clockAt=Date.parse(NOW); const clock=()=>new Date(clockAt);
 const memory=xPageSchema12();applyRssAutomaticMigration(memory,{applyEnabled:true});
 seed(memory,()=>{
  memory.prepare("UPDATE internal_control SET phase='live',global_stop_state=?,recovery_state='ready',deletion_fence_state='clear',publication_fence_state='clear',updated_at=?,writer_authority_receipt_sha256=?").run(stopped?"stopped":"clear",NOW,"1".repeat(64));
  memory.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES(?,'motorsport-f1-news','synthetic-guid',?,'https://www.motorsport.com/f1/news/synthetic/','F1 test news','F1 test summary','Synthetic',?,?,?,?,?)`).run(target.candidateId,digest("synthetic"),NOW,target.inputContentHash,target.sourceRevision,NOW,NOW);
  if(withDraft)memory.prepare("INSERT INTO machine_summary_draft VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("draft-"+digest("synthetic-draft"),target.candidateId,target.sourceRevision,target.inputContentHash,"deepseek-chat",DEEPSEEK_PROMPT_SHA256,"b".repeat(64),"F1测试新闻","用于隔离验证自动处理流程的中文摘要。",'["验证当前原文版本"]',8,8,NOW);
  memory.prepare("INSERT INTO budget_account VALUES('acct-rss','request',100,0,0,1)").run();
  memory.prepare("INSERT INTO route_registry VALUES('route-deepseek','model','model_https','model_refine',?,?,?,'active',1)").run(digest("https://api.deepseek.com/chat/completions"),ZERO,ZERO);
 });assertRssAutomaticSchema(memory);
 const root=mkdtempSync(join(realpathSync(tmpdir()),"rss-automatic-test-")),path=join(root,"clone.sqlite");
 await backup(memory,path);memory.close();chmodSync(path,0o600);
 const db=openExistingSafeDatabase(path,"clone.sqlite",inspectExistingPrivateDatabase(path,"clone.sqlite"),[10]);
 cleanups.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});
 const queues=new Map<OwnerProcess,Array<Parameters<typeof persistOwnerSupervisorHandoff>[1]>>();
 for(const owner of ["system_supervisor","automatic_reviewer","automatic_publisher","rss_refiner","admin_http","projection_sender","reconciler"] as const){const values=[];for(let i=0;i<96;i++){
  const id=`synthetic-${owner}-${i}`,h={handoffId:id,ownerProcess:owner,issuer:"f1plus1-owner-supervisor-v1" as const,oneTimeNonce:createHash("sha256").update(id).digest("base64url"),releaseSha256:ZERO,manifestSha256:ZERO,receiptSha256:digest(id),verifiedAt:NOW,expiresAt:"2027-09-07T00:00:00.000Z"};persistOwnerSupervisorHandoff(db,h,()=>true);values.push(h);
 }queues.set(owner,values);}
 const gateway=new SqliteInternalOperationGateway({database:db,schemaSha256:RSS_AUTOMATIC_SCHEMA_SHA256,releaseSha256:ZERO,manifestSha256:ZERO,now:clock});cleanups.push(()=>gateway.close());
 const port=(owner:OwnerProcess)=>new SqliteGatewayMutationPort({database:db,gateway,ownerProcess:owner,now:clock,handoffProvider:()=>{const h=queues.get(owner)!.shift();if(!h)throw new Error("SYNTHETIC_HANDOFF_EXHAUSTED");return h;}});
 const supervisorPort=port("system_supervisor"),reviewer=new ReviewRealRepository(db,clock,port("automatic_reviewer")),publisher=new ReviewRealRepository(db,clock,port("automatic_publisher"));
 const keyPath=join(root,"deepseek-api-key");writeFileSync(keyPath,"sk-"+"x".repeat(24),{mode:0o600});
 return {database:db,gateway,supervisorPort,reviewer,publisher,port,keyPath,root,cutoffIso:CUTOFF,now:clock,advanceNow:(milliseconds:number)=>{clockAt+=milliseconds;},
  fixtureMutation:(callback:(other:DatabaseSync)=>void)=>{const other=new DatabaseSync(path);try{other.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");seed(other,()=>callback(other));}finally{other.close();}}};
}
const idle=async()=>({schemaVersion:"rss-refinement-receipt-v1" as const,status:"idle" as const,candidateId:null,sourceRevision:null,model:"deepseek-chat" as const,promptSha256:DEEPSEEK_PROMPT_SHA256,responseSha256:null,inputTokens:0,outputTokens:0,externalCalls:0 as const});
const modelResponse=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"恢复后的F1新闻",summaryZh:"经过正式模型调用恢复的中文新闻摘要。",keyPointsZh:["验证恢复路径"]})}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200});
describe("RSS automatic successor",()=>{
 test("migration rejects attached databases before modifying schema",()=>{const db=xPageSchema12();try{db.exec("ATTACH ':memory:' AS unexpected");expect(()=>applyRssAutomaticMigration(db,{applyEnabled:true})).toThrow("ATTACHED_DATABASE");expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='rss_automatic_fence_current_v1'").get()).toBeUndefined();}finally{db.close();}});
 test("historical candidate with a missing committed image cannot refine or publish",async()=>{const env=await ready();const media={url:"https://cdn-1.motorsport.com/images/mgl/test/s8/f1.jpg",mimeType:"image/jpeg",declaredBytes:1};const hash=payloadHash(undefined,undefined,undefined,media);
  env.fixtureMutation(db=>{db.prepare("UPDATE pending_review_candidate SET source_payload_hash=? WHERE candidate_id=?").run(hash,target.candidateId);db.prepare("UPDATE machine_summary_draft SET source_payload_hash=? WHERE candidate_id=?").run(hash,target.candidateId);});
  let calls=0;const blocked=await runRssAutomaticCycle({...env,refine:async()=>{calls++;return idle();}});expect(blocked.items[0]?.reasonCode).toBe("RSS_AUTO_PAYLOAD_INCOMPLETE");expect(calls).toBe(0);expect(blocked.published).toBe(0);
  env.fixtureMutation(db=>db.prepare("INSERT INTO rss_media_candidate VALUES(?,?,?,?,?,?,?)").run(target.candidateId,3,hash,media.url,media.mimeType,media.declaredBytes,NOW));
  expect(()=>assertRssAutomaticTarget(env.database,{...target,inputContentHash:hash},CUTOFF,env.now())).not.toThrow();
 });
 test("migration exact predecessor and replay",()=>{const db=xPageSchema12();try{expect(applyRssAutomaticMigration(db,{applyEnabled:true}).schemaSha256).toBe(RSS_AUTOMATIC_SCHEMA_SHA256);expect(applyRssAutomaticMigration(db,{applyEnabled:true}).applied).toBe(false);}finally{db.close();}const other=xPageSchema12();other.exec("CREATE TABLE unexpected(value TEXT)");try{expect(()=>applyRssAutomaticMigration(other,{applyEnabled:true})).toThrow("PREDECESSOR_DRIFT");expect(other.prepare("SELECT 1 FROM sqlite_schema WHERE name='rss_automatic_fence_current_v1'").get()).toBeUndefined();}finally{other.close();}});
 test("current revision issues, reviews, publishes and replays without manual HTTP rows",async()=>{const env=await ready();expect(assertRssAutomaticTarget(env.database,target,CUTOFF,new Date(NOW)).registry_revision).toBe(1);expect(issueRssAutomaticFences({...env,target})).toEqual({issued:5,reused:0});expect(issueRssAutomaticFences({...env,target})).toEqual({issued:0,reused:5});const result=await runRssAutomaticCycle({...env,refine:idle});expect(result,JSON.stringify(result)).toMatchObject({status:"processed",approved:1,published:1,considered:1});expect(env.database.prepare("SELECT count(*) n FROM admin_operation").get()!.n).toBe(0);expect(env.publisher.publishAutomaticCandidate(target)).toMatchObject({kind:"publish",deliveryId:result.deliveryId});expect(env.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);});
 test("stopped and cutoff reject before model or operations",async()=>{const env=await ready(true,true);let calls=0;const result=await runRssAutomaticCycle({...env,refine:async()=>{calls++;return idle();}});expect(result.status).toBe("blocked");expect(calls).toBe(0);expect(env.database.prepare("SELECT count(*) n FROM internal_operation").get()!.n).toBe(0);expect(()=>assertRssAutomaticTarget(env.database,target,"2026-09-08T00:00:00.000Z",new Date(NOW))).toThrow("BEFORE_CUTOFF");});
 test("target mismatch rejects before key read or external call",async()=>{const env=await ready(false);let calls=0;await expect(refineOneCandidate({database:env.database,mutationPort:env.port("rss_refiner"),target:{...target,sourceRevision:2},apiKeyPath:"/missing",fetchImpl:async()=>{calls++;return new Response();}})).rejects.toThrow("SOURCE_STALE");expect(calls).toBe(0);});
 test("gateway model result stores locally then reviews and publishes",async()=>{const env=await ready(false);let calls=0;const result=await runRssAutomaticCycle({...env,refine:t=>refineOneCandidate({database:env.database,mutationPort:env.port("rss_refiner"),target:t,apiKeyPath:env.keyPath,budgetAccountId:"acct-rss",now:env.now,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"F1测试新闻",summaryZh:"用于隔离验证自动处理流程的中文摘要。",keyPointsZh:["验证当前原文版本"]})}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200});}})});expect(result,JSON.stringify(result)).toMatchObject({status:"processed",refined:1,approved:1,published:1});expect(calls).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM internal_external_attempt").get()!.n).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM internal_operation WHERE policy_id='p-refine-rss-store-live' AND state='succeeded'").get()!.n).toBe(1);});
 test("source update invalidates every old bound receipt before reuse or review",async()=>{
  const env=await ready();issueRssAutomaticFences({...env,target});
  env.fixtureMutation(db=>db.prepare("UPDATE pending_review_candidate SET source_revision=4,source_payload_hash=?,title='F1 updated news' WHERE candidate_id=?").run(NEXT_HASH,target.candidateId));
  expect(env.database.prepare("SELECT count(*) n FROM rss_automatic_fence_current_v1").get()!.n).toBe(0);
  const next={...target,sourceRevision:4,inputContentHash:NEXT_HASH};
  expect(()=>env.reviewer.reviewAutomaticCandidate(target)).toThrow("SOURCE_STALE");
  expect(issueRssAutomaticFences({...env,target:next})).toEqual({issued:5,reused:0});
  expect(env.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n).toBe(10);
 });
 test("source changes during provider response prevent stale draft persistence",async()=>{
  const env=await ready(false);issueRssAutomaticFences({...env,target});let calls=0;
  await expect(refineOneCandidate({database:env.database,mutationPort:env.port("rss_refiner"),target,apiKeyPath:env.keyPath,budgetAccountId:"acct-rss",now:env.now,
   fetchImpl:async()=>{calls++;env.fixtureMutation(db=>db.prepare("UPDATE pending_review_candidate SET source_revision=4,source_payload_hash=?,title='F1 updated news' WHERE candidate_id=?").run(NEXT_HASH,target.candidateId));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"旧版本稿件",summaryZh:"旧版本中文摘要",keyPointsZh:["旧版本"]})}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});}
  })).rejects.toThrow("RSS_AUTO_FENCE_STALE");
  expect(calls).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM machine_summary_draft").get()!.n).toBe(0);
  expect(env.database.prepare("SELECT state FROM internal_external_attempt").get()!.state).toBe("reconcile_required");
 });
 test("manual rejection of the current source version is respected",async()=>{
  const env=await ready();issueRssAutomaticFences({...env,target});const admin=new ReviewRealRepository(env.database,env.now,env.port("admin_http"));
  const revision=admin.revision({schemaVersion:"admin-review-v0.2",operationId:"synthetic-manual-revision",expected:{candidateId:target.candidateId,sourceRevision:3,sourceVersionTag:target.inputContentHash.slice(0,12),latestBundleId:null,latestBundleVersionTag:null},editable:{titleZh:"人工审核标题",summaryZh:"人工审核摘要",notes:""}},"/api/admin/synthetic/revision","operator-test");
  admin.reject({schemaVersion:"admin-review-v0.2",operationId:"synthetic-manual-reject",expected:{candidateId:target.candidateId,sourceRevision:3,bundleId:revision.bundle.id,bundleVersionTag:revision.bundle.versionTag},reason:"人工决定不发布"},"/api/admin/synthetic/reject","operator-test");
  expect(()=>issueRssAutomaticFences({...env,target})).toThrow("MANUAL_OVERRIDE");
  expect(()=>env.reviewer.reviewAutomaticCandidate(target)).toThrow("MANUAL_OVERRIDE");
  expect(env.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get()!.n).toBe(0);
 });
 test("current human bundle is preserved; a newer source version can proceed",async()=>{
  const env=await ready();issueRssAutomaticFences({...env,target});const admin=new ReviewRealRepository(env.database,env.now,env.port("admin_http"));
  const revision=admin.revision({schemaVersion:"admin-review-v0.2",operationId:"synthetic-human-edited",expected:{candidateId:target.candidateId,sourceRevision:3,sourceVersionTag:target.inputContentHash.slice(0,12),latestBundleId:null,latestBundleVersionTag:null},editable:{titleZh:"人工保留标题",summaryZh:"人工保留摘要",notes:"保留人工说明"}},"/api/admin/synthetic/revision","operator-test");
  const original=env.database.prepare("SELECT * FROM review_bundle WHERE bundle_id=?").get(revision.bundle.id);
  let calls=0;const blocked=await runRssAutomaticCycle({...env,refine:async()=>{calls++;return idle();}});
  expect(blocked.published).toBe(0);expect(calls).toBe(0);expect(env.database.prepare("SELECT * FROM review_bundle WHERE bundle_id=?").get(revision.bundle.id)).toEqual(original);
  env.fixtureMutation(db=>{db.prepare("UPDATE pending_review_candidate SET source_revision=4,source_payload_hash=?,title='F1 updated news' WHERE candidate_id=?").run(NEXT_HASH,target.candidateId);
   db.prepare("INSERT INTO machine_summary_draft SELECT ?,candidate_id,4,?,model,prompt_sha256,response_sha256,title_zh,summary_zh,key_points_zh_json,input_tokens,output_tokens,generated_at FROM machine_summary_draft WHERE candidate_id=?").run("draft-"+digest("new-source"),NEXT_HASH,target.candidateId);});
  const next=await runRssAutomaticCycle({...env,refine:idle});expect(next,JSON.stringify(next)).toMatchObject({approved:1,published:1});
  expect(env.database.prepare("SELECT * FROM review_bundle WHERE bundle_id=?").get(revision.bundle.id)).toEqual(original);
 });
 test("persistent cursor advances beyond five failures across worker restarts",async()=>{
  const env=await ready();env.fixtureMutation(db=>{for(let i=0;i<5;i++)db.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) SELECT ?,source_id,?,?,canonical_url||?,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at FROM pending_review_candidate WHERE candidate_id=?`).run(`aaa-blocked-${i}`,`blocked-guid-${i}`,digest(`blocked-${i}`),`${i}/`,target.candidateId);});
  const refine=async(t:typeof target)=>{if(t.candidateId.startsWith("aaa-"))throw new Error("MODEL_INVALID");return idle();};
  const first=await runRssAutomaticCycle({...env,cursorStore:createRssAutomaticCursorStore({privateDir:env.root}),refine});expect(first).toMatchObject({considered:5,published:0});
  // A SIGKILL can leave an old lock or uncommitted temporary. Neither carries
  // progress or candidate authority, and neither may wedge future cycles.
  writeFileSync(join(env.root,"rss-automatic-cursor.json.lock"),"",{mode:0o600});
  writeFileSync(join(env.root,".rss-automatic-cursor.json.synthetic.tmp"),"incomplete",{mode:0o600});
  const restarted=await runRssAutomaticCycle({...env,cursorStore:createRssAutomaticCursorStore({privateDir:env.root}),refine});expect(restarted,JSON.stringify(restarted)).toMatchObject({considered:1,published:1});
  expect(statSync(join(env.root,"rss-automatic-cursor.json")).mode&0o777).toBe(0o600);
  const wrap=await runRssAutomaticCycle({...env,cursorStore:createRssAutomaticCursorStore({privateDir:env.root}),refine});expect(wrap.considered).toBe(5);
 });
 test.each(["http401","http429","invalid_json","store_failure"] as const)("known model response can recover after %s with a new budgeted attempt",async mode=>{
  const env=await ready(false);issueRssAutomaticFences({...env,target});const port=env.port("rss_refiner");let calls=0;
  const broken=mode==="store_failure"?vi.spyOn(port,"runTransaction").mockImplementationOnce(()=>{throw new Error("SYNTHETIC_STORE_FAILURE");}):null;
  const input={database:env.database,mutationPort:port,target,apiKeyPath:env.keyPath,budgetAccountId:"acct-rss",now:env.now,fetchImpl:async()=>{calls++;if(calls===1){if(mode==="http401")return new Response("denied",{status:401});if(mode==="http429")return new Response("retry later",{status:429});if(mode==="invalid_json")return new Response("not json",{status:200});}return modelResponse();}};
  await expect(refineOneCandidate(input)).rejects.toThrow();broken?.mockRestore();
  expect(env.database.prepare("SELECT count(*) n FROM machine_summary_draft").get()!.n).toBe(0);
  await expect(refineOneCandidate(input)).rejects.toThrow("RETRY_BACKOFF");expect(calls).toBe(1);
  env.advanceNow(60_000);const result=await refineOneCandidate(input);expect(result.status).toBe("generated");expect(calls).toBe(2);
  const attempts=env.database.prepare("SELECT op.operation_id,op.state,reservation.account_id FROM internal_operation op JOIN internal_external_attempt attempt ON attempt.operation_id=op.operation_id JOIN budget_reservation reservation ON reservation.operation_id=op.operation_id ORDER BY op.operation_id").all();
  expect(attempts).toHaveLength(2);expect(attempts.every(row=>row.account_id==="acct-rss")).toBe(true);expect(attempts[1].operation_id).toMatch(/-retry-1$/);
  expect(env.database.prepare("SELECT count(*) n FROM machine_summary_draft").get()!.n).toBe(1);
 });
 test("unknown model attempt never retries even after backoff or process restart",async()=>{
  const env=await ready(false);issueRssAutomaticFences({...env,target});let calls=0;
  const input={database:env.database,mutationPort:env.port("rss_refiner"),target,apiKeyPath:env.keyPath,budgetAccountId:"acct-rss",now:env.now,fetchImpl:async()=>{calls++;throw new Error("NETWORK_RESPONSE_LOST");}};
  await expect(refineOneCandidate(input)).rejects.toThrow("NETWORK_RESPONSE_LOST");env.advanceNow(60_000);
  await expect(refineOneCandidate({...input,mutationPort:env.port("rss_refiner"),fetchImpl:async()=>{calls++;return modelResponse();}})).rejects.toThrow("EXTERNAL_RECONCILE_REQUIRED");
  expect(calls).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM internal_external_attempt").get()!.n).toBe(1);
 });
 test.each([0,1,900001])("formal projection sender delivers the committed generation and a source update: pre-delivery delay=%s",async delay=>{
  const updateBeforeDelivery=delay>0;
  const env=await ready();env.fixtureMutation(db=>{db.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();db.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),ZERO,ZERO);});
  const keys=generateKeyPairSync("ed25519"),receiver=new ProjectionReceiver({root:join(env.root,"public-projection"),signingKeyId:"synthetic-key",publicKey:keys.publicKey,now:()=>env.now().getTime()});
  const port=env.port("projection_sender"),repository=new ReviewRealRepository(env.database,env.now,port);let posts=0;
  const sender=new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery(env);},repository,signingKeyId:"synthetic-key",privateKey:keys.privateKey,actorRef:"projection-sender",
   externalAttempt:port.runExternal.bind(port),externalReconcile:port.runReconcile.bind(port),transport:{post:async value=>{posts++;return {kind:"response",status:200,body:receiver.receive(value)};},getReceipt:async deliveryId=>({kind:"response",status:200,body:receiver.getReceipt(deliveryId)})}});
  const updateSource=()=>{env.advanceNow(1_000);env.fixtureMutation(db=>{db.prepare("UPDATE pending_review_candidate SET source_revision=4,source_payload_hash=?,title='F1 updated news' WHERE candidate_id=?").run(NEXT_HASH,target.candidateId);
   db.prepare("INSERT INTO machine_summary_draft SELECT ?,candidate_id,4,?,model,prompt_sha256,response_sha256,?,summary_zh,key_points_zh_json,input_tokens,output_tokens,generated_at FROM machine_summary_draft WHERE candidate_id=?").run("draft-"+digest("published-source-update"),NEXT_HASH,"已发布新闻的新版标题",target.candidateId);});};
  const first=await runRssAutomaticCycle({...env,refine:idle});expect(first.published).toBe(1);
  if(updateBeforeDelivery){updateSource();env.advanceNow(delay);}
  await expect(sender.tick()).resolves.toMatchObject({outcome:"succeeded",deliveryId:first.deliveryId});expect(posts).toBe(1);
  expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
  if(!updateBeforeDelivery)updateSource();else env.advanceNow(1_000);
  const next=await runRssAutomaticCycle({...env,refine:idle});expect(next,JSON.stringify(next)).toMatchObject({approved:1,published:1});
  await expect(sender.tick()).resolves.toMatchObject({outcome:"succeeded",deliveryId:next.deliveryId});expect(posts).toBe(2);
  const snapshot=receiver.readActiveSnapshot();expect(snapshot?.snapshotGeneration).toBe(2);expect(JSON.stringify(snapshot)).toContain("已发布新闻的新版标题");
  expect(env.database.prepare("SELECT count(*) n FROM internal_external_attempt WHERE endpoint_class='projection_deliver' AND outcome='succeeded'").get()!.n).toBe(2);
  expect(env.database.prepare("SELECT count(*) n FROM projection_delivery_receipt").get()!.n).toBe(2);
 });
 test.each(["current", "expired", "local_commit_crash", "404", "500", "timeout", "mismatch", "body_hash", "source_stopped"] as const)("durable projection observation closes only exact original delivery: %s",async mode=>{
  const env=await ready();env.fixtureMutation(db=>{db.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();db.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),ZERO,ZERO);});
  const keys=generateKeyPairSync("ed25519"),receiver=new ProjectionReceiver({root:join(env.root,"durable-public"),signingKeyId:"durable-key",publicKey:keys.publicKey,now:()=>env.now().getTime()});
  let posts=0,gets=0;const senderPort=env.port("projection_sender"),repository=new ReviewRealRepository(env.database,env.now,senderPort);
  const createSender=()=>{const reconciler=env.port("reconciler");return new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery(env);},repository,signingKeyId:"durable-key",privateKey:keys.privateKey,actorRef:"durable-sender",
   externalAttempt:senderPort.runExternal.bind(senderPort),externalReconcile:async input=>reconciler.runProjectionReconcile({...input,execute:async handle=>{const result=await input.execute(handle);return mode==="body_hash"?{...result,response:{...result.response,responseBodySha256:ZERO}}:result;}}),
   transport:{post:async value=>{posts++;receiver.receive(value);return {kind:"unknown"};},getReceipt:async id=>{gets++;if(mode==="timeout")return {kind:"unknown"};if(mode==="404"||mode==="500")return {kind:"response",status:Number(mode),body:null};const receipt=receiver.getReceipt(id);return {kind:"response",status:200,body:mode==="mismatch"?{...receipt,snapshotGeneration:999}:receipt};}}});};
  const published=await runRssAutomaticCycle({...env,refine:idle});expect(published.published).toBe(1);
  await expect(createSender().tick()).resolves.toMatchObject({outcome:"reconcile_wait"});expect(posts).toBe(1);
  const original=env.database.prepare("SELECT a.attempt_id,a.operation_id,op.budget_reservation_id FROM internal_external_attempt a JOIN internal_operation op ON op.operation_id=a.operation_id WHERE op.owner_process='projection_sender'").get()!;
  if(mode==="expired")env.advanceNow(960_000);
  if(mode==="source_stopped")env.fixtureMutation(db=>db.exec("UPDATE source SET enabled=0 WHERE source_id='motorsport-f1-news'"));
  if(mode==="local_commit_crash"){
   const commit=vi.spyOn(repository,"markDeliverySucceeded").mockImplementationOnce(()=>{throw new Error("LOCAL_OUTBOX_CRASH");});
   await expect(createSender().tick()).rejects.toThrow("LOCAL_OUTBOX_CRASH");commit.mockRestore();
   expect(env.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(published.deliveryId)!.status).toBe("reconcile_wait");
  }
  const sender=createSender();
  if(mode==="source_stopped")await expect(sender.tick()).rejects.toThrow();
  else await expect(sender.tick()).resolves.toMatchObject({outcome:["current","expired","local_commit_crash"].includes(mode)?"succeeded":"reconcile_wait"});
  const success=["current","expired","local_commit_crash"].includes(mode);
  expect(posts).toBe(1);expect(gets).toBe(mode==="source_stopped"?0:1);
  expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
  expect(env.database.prepare("SELECT state,outcome,external_calls FROM internal_external_attempt WHERE attempt_id=?").get(original.attempt_id)).toMatchObject({state:success?"response_committed":"reconcile_required",outcome:success?"succeeded":"unknown",external_calls:1});
  expect(env.database.prepare("SELECT state,reason_code FROM internal_operation WHERE operation_id=?").get(original.operation_id)).toMatchObject({state:success?(mode==="expired"?"terminal_failed":"succeeded"):"reconcile_required",...(mode==="expired"?{reason_code:"LOCAL_COMPLETION_AUTHORITY_EXPIRED"}:{})});
  expect(env.database.prepare("SELECT state FROM budget_reservation WHERE reservation_id=?").get(original.budget_reservation_id)!.state).toBe(success?"consumed":"reconcile_required");
  if(success){expect(env.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toMatchObject({consumed_units:2,reserved_units:0});expect(env.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='reconciler' AND state='succeeded'").get()!.n).toBe(1);await expect(sender.tick()).resolves.toMatchObject({outcome:"idle"});expect(gets).toBe(1);}
  else if(mode!=="source_stopped"){const attention=env.database.prepare("SELECT json_extract(event_json,'$.projectionAttention.reasonCode') reason FROM internal_operation_audit WHERE json_extract(event_json,'$.projectionAttention.deliveryId')=?").all(published.deliveryId);expect(attention).toHaveLength(1);expect(String(attention[0].reason)).toMatch(/^PROJECTION_RECONCILE_/);await expect(createSender().tick()).resolves.toMatchObject({outcome:"reconcile_wait"});expect(gets).toBe(1);expect(env.database.prepare("SELECT count(*) n FROM internal_operation_audit WHERE json_extract(event_json,'$.projectionAttention.deliveryId')=?").get(published.deliveryId)!.n).toBe(1);}
 });
 test.each(["current", "expired", "local_commit_crash", "404", "500", "timeout", "mismatch", "body_hash", "source_stopped", "wrong_original_hash", "prior_release"] as const)("committed successful POST survives missing local outbox completion: %s",async mode=>{
  const env=await ready();env.fixtureMutation(db=>{db.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();db.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),ZERO,ZERO);});
  const keys=generateKeyPairSync("ed25519"),receiver=new ProjectionReceiver({root:join(env.root,"success-public"),signingKeyId:"success-key",publicKey:keys.publicKey,now:()=>env.now().getTime()});
  let posts=0,gets=0;const senderPort=env.port("projection_sender"),repository=new ReviewRealRepository(env.database,env.now,senderPort);
  const createSender=()=>{const reconciler=env.port("reconciler");return new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery(env);},repository,signingKeyId:"success-key",privateKey:keys.privateKey,actorRef:"success-sender",
   externalAttempt:senderPort.runExternal.bind(senderPort),externalReconcile:async input=>reconciler.runProjectionReconcile({...input,execute:async handle=>{const result=await input.execute(handle);return mode==="body_hash"?{...result,response:{...result.response,responseBodySha256:ZERO}}:result;}}),
   transport:{post:async value=>{posts++;return {kind:"response",status:200,body:receiver.receive(value)};},getReceipt:async id=>{gets++;if(mode==="timeout")return {kind:"unknown"};if(mode==="404"||mode==="500")return {kind:"response",status:Number(mode),body:null};const receipt=receiver.getReceipt(id);return {kind:"response",status:200,body:mode==="mismatch"?{...receipt,snapshotGeneration:999}:receipt};}}});};
  const published=await runRssAutomaticCycle({...env,refine:idle});expect(published.published).toBe(1);
  const crash=vi.spyOn(repository,"markDeliverySucceeded").mockImplementationOnce(()=>{throw new Error("POST_COMMITTED_LOCAL_OUTBOX_CRASH");});
  await expect(createSender().tick()).rejects.toThrow("POST_COMMITTED_LOCAL_OUTBOX_CRASH");crash.mockRestore();
  if(mode==="wrong_original_hash" || mode==="prior_release")env.fixtureMutation(db=>db.prepare(`UPDATE internal_operation SET ${mode==="wrong_original_hash"?"result_hash":"expected_release_sha256"}=? WHERE operation_id IN (SELECT operation_id FROM internal_external_attempt WHERE endpoint_class='projection_deliver')`).run("e".repeat(64)));
  const originalAttempt=env.database.prepare("SELECT a.* FROM internal_external_attempt a JOIN internal_operation op ON op.operation_id=a.operation_id WHERE op.owner_process='projection_sender'").get()!;
  const originalOperation=env.database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(originalAttempt.operation_id)!;
  const originalBudget=env.database.prepare("SELECT * FROM budget_reservation WHERE reservation_id=?").get(originalOperation.budget_reservation_id)!;
  expect(originalAttempt).toMatchObject({state:"response_committed",outcome:"succeeded",external_calls:1,reconcile_consumed_at:null});
  expect(originalOperation.state).toBe("succeeded");expect(originalBudget.state).toBe("consumed");
  expect(env.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(published.deliveryId)!.status).toBe("leased");
  env.advanceNow(mode==="expired"?960_000:61_000);
  if(mode==="source_stopped")env.fixtureMutation(db=>db.exec("UPDATE source SET enabled=0 WHERE source_id='motorsport-f1-news'"));
  if(mode==="local_commit_crash"){
   const commit=vi.spyOn(repository,"markDeliverySucceeded").mockImplementationOnce(()=>{throw new Error("CONFIRMED_LOCAL_OUTBOX_CRASH");});
   await expect(createSender().tick()).rejects.toThrow("CONFIRMED_LOCAL_OUTBOX_CRASH");commit.mockRestore();
   expect(env.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(published.deliveryId)!.status).toBe("reconcile_wait");
  }
  const success=["current","expired","local_commit_crash"].includes(mode),sender=createSender();
  if(mode==="source_stopped")await expect(sender.tick()).rejects.toThrow();
  else await expect(sender.tick()).resolves.toMatchObject({outcome:success?"succeeded":"reconcile_wait"});
  const blockedBeforeGet=["source_stopped","wrong_original_hash","prior_release"].includes(mode);
  expect(posts).toBe(1);expect(gets).toBe(blockedBeforeGet?0:1);
  expect(env.database.prepare("SELECT * FROM internal_external_attempt WHERE attempt_id=?").get(originalAttempt.attempt_id)).toEqual(originalAttempt);
  expect(env.database.prepare("SELECT * FROM internal_operation WHERE operation_id=?").get(originalAttempt.operation_id)).toEqual(originalOperation);
  expect(env.database.prepare("SELECT * FROM budget_reservation WHERE reservation_id=?").get(originalOperation.budget_reservation_id)).toEqual(originalBudget);
  expect(env.database.prepare("SELECT count(*) n FROM projection_delivery_receipt").get()!.n).toBe(success?1:0);
  expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
  if(success){expect(env.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toMatchObject({consumed_units:2,reserved_units:0});await expect(sender.tick()).resolves.toMatchObject({outcome:"idle"});expect(gets).toBe(1);}
  else if(mode!=="source_stopped"){await expect(createSender().tick()).resolves.toMatchObject({outcome:"reconcile_wait"});expect(gets).toBe(blockedBeforeGet?0:1);}
 });
 test.each(["no_attempt","intent_unstarted"] as const)("expired delivery lease distinguishes proven no egress from an unstarted durable intent: %s",async mode=>{
  const env=await ready();env.fixtureMutation(db=>{db.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();db.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),ZERO,ZERO);});
  const keys=generateKeyPairSync("ed25519"),receiver=new ProjectionReceiver({root:join(env.root,"unstarted-public"),signingKeyId:"unstarted-key",publicKey:keys.publicKey,now:()=>env.now().getTime()});
  let posts=0,gets=0;const senderPort=env.port("projection_sender"),repository=new ReviewRealRepository(env.database,env.now,senderPort),reconciler=env.port("reconciler");
  const sender=new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery(env);},repository,signingKeyId:"unstarted-key",privateKey:keys.privateKey,actorRef:"unstarted-sender",externalAttempt:senderPort.runExternal.bind(senderPort),externalReconcile:reconciler.runProjectionReconcile.bind(reconciler),transport:{post:async value=>{posts++;return {kind:"response",status:200,body:receiver.receive(value)};},getReceipt:async id=>{gets++;return {kind:"response",status:200,body:receiver.getReceipt(id)};}}});
  const published=await runRssAutomaticCycle({...env,refine:idle});expect(published.published).toBe(1);
  if(mode==="no_attempt"){
   expect(repository.leaseNext("unstarted-sender")?.deliveryId).toBe(published.deliveryId);env.advanceNow(61_000);
   await expect(sender.tick()).resolves.toMatchObject({outcome:"succeeded",deliveryId:published.deliveryId});expect(posts).toBe(1);expect(gets).toBe(0);
   expect(env.database.prepare("SELECT consumed_units,reserved_units FROM budget_account WHERE account_id='acct-projection'").get()).toMatchObject({consumed_units:1,reserved_units:0});
  }else{
   const start=vi.spyOn(env.gateway,"markAttemptStarted").mockImplementationOnce(()=>{throw new Error("EXIT_BEFORE_EGRESS_START");});
   await expect(sender.tick()).resolves.toMatchObject({outcome:"reconcile_wait"});start.mockRestore();env.advanceNow(61_000);
   await expect(sender.tick()).resolves.toMatchObject({outcome:"reconcile_wait"});expect(posts).toBe(0);expect(gets).toBe(0);
   expect(env.database.prepare("SELECT state,outcome,external_calls FROM internal_external_attempt").get()).toMatchObject({state:"intent_committed",outcome:"pending",external_calls:0});
   expect(env.database.prepare("SELECT json_extract(event_json,'$.projectionAttention.reasonCode') reason FROM internal_operation_audit WHERE json_extract(event_json,'$.projectionAttention.deliveryId')=?").get(published.deliveryId)!.reason).toBe("PROJECTION_RECONCILE_NOT_STARTED_NEEDS_ATTENTION");
  }
 });
 test.each([[true,0],[true,900001],[false,0]] as const)("paired fallback sends only its existing full-release delivery: paired=%s delay=%s",async (correctPair,delay)=>{
  const env=await ready();const result=await runRssAutomaticCycle({...env,refine:idle});expect(result.published).toBe(1);
  env.fixtureMutation(db=>{db.prepare("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)").run();db.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(digest("127.0.0.1:3102/internal/projections"),ZERO,"f".repeat(64));});
  env.advanceNow(delay);env.gateway.close();const fallbackManifest="f".repeat(64);
  const handoffs:Array<Parameters<typeof persistOwnerSupervisorHandoff>[1]>=[];for(let index=0;index<5;index++){const id=`fallback-sender-${index}`,handoff={handoffId:id,ownerProcess:"projection_sender" as const,issuer:"f1plus1-owner-supervisor-v1" as const,
    oneTimeNonce:createHash("sha256").update(id).digest("base64url"),releaseSha256:ZERO,manifestSha256:fallbackManifest,receiptSha256:digest(id),verifiedAt:NOW,expiresAt:"2027-09-07T00:00:00.000Z"};persistOwnerSupervisorHandoff(env.database,handoff,()=>true);handoffs.push(handoff);}
  const supervisorHandoffs:Array<Parameters<typeof persistOwnerSupervisorHandoff>[1]>=[];
  for(let index=0;index<5;index++){const id=`fallback-renew-${index}`,handoff={handoffId:id,ownerProcess:"system_supervisor" as const,issuer:"f1plus1-owner-supervisor-v1" as const,oneTimeNonce:createHash("sha256").update(id).digest("base64url"),releaseSha256:ZERO,manifestSha256:fallbackManifest,receiptSha256:digest(id),verifiedAt:NOW,expiresAt:"2027-09-07T00:00:00.000Z"};persistOwnerSupervisorHandoff(env.database,handoff,()=>true);supervisorHandoffs.push(handoff);}
  const gateway=new SqliteInternalOperationGateway({database:env.database,releaseSha256:ZERO,manifestSha256:fallbackManifest,schemaSha256:RSS_AUTOMATIC_SCHEMA_SHA256,verifiedRssAutomaticFullManifestSha256:correctPair?ZERO:"a".repeat(64),now:env.now});cleanups.push(()=>gateway.close());
  const port=new SqliteGatewayMutationPort({database:env.database,gateway,ownerProcess:"projection_sender",now:env.now,handoffProvider:()=>handoffs.shift()!});
  const supervisorPort=new SqliteGatewayMutationPort({database:env.database,gateway,ownerProcess:"system_supervisor",now:env.now,handoffProvider:()=>supervisorHandoffs.shift()!});
  const keys=generateKeyPairSync("ed25519"),receiver=new ProjectionReceiver({root:join(env.root,"fallback-public"),signingKeyId:"fallback-key",publicKey:keys.publicKey,now:()=>env.now().getTime()});
  let posts=0;const sender=new ProjectionSender({prepareDeliveryAuthority:()=>{prepareRssAutomaticDelivery({...env,gateway,supervisorPort});},repository:new ReviewRealRepository(env.database,env.now,port),signingKeyId:"fallback-key",privateKey:keys.privateKey,actorRef:"fallback-sender",
   externalAttempt:port.runExternal.bind(port),externalReconcile:port.runReconcile.bind(port),transport:{post:async value=>{posts++;return {kind:"response",status:200,body:receiver.receive(value)};},getReceipt:async id=>({kind:"response",status:200,body:receiver.getReceipt(id)})}});
  const automaticBefore=env.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get()!.n;
  if(!correctPair){await expect(sender.tick()).rejects.toThrow();expect(posts).toBe(0);expect(env.database.prepare("SELECT status FROM projection_outbox WHERE delivery_id=?").get(result.deliveryId)!.status).toBe("pending");return;}
  await expect(sender.tick()).resolves.toMatchObject({outcome:"succeeded",deliveryId:result.deliveryId});expect(receiver.readActiveSnapshot()?.snapshotGeneration).toBe(1);
  expect(env.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher')").get()!.n).toBe(automaticBefore);
  expect(env.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='projection_sender' AND expected_manifest_sha256=? AND state='succeeded'").get(fallbackManifest)!.n).toBe(3);
 });
 test.each(["authorization_expired","source_stopped","source_identity_changed","rights_blocked","global_stop","writer_changed","publication_revoked"] as const)("delivery renewal cannot override current %s",async mode=>{
  const env=await ready();await runRssAutomaticCycle({...env,refine:idle});env.advanceNow(900001);
  env.fixtureMutation(db=>{
   if(mode==="authorization_expired")db.prepare("UPDATE source_registry_v1 SET authorization_expires_at=? WHERE source_id='motorsport-f1-news'").run(NOW);
   if(mode==="source_stopped")db.exec("UPDATE source SET enabled=0 WHERE source_id='motorsport-f1-news'");
   if(mode==="source_identity_changed")db.prepare("UPDATE source_registry_v1 SET identity_sha256=? WHERE source_id='motorsport-f1-news'").run("f".repeat(64));
   if(mode==="rights_blocked")db.exec("UPDATE source_registry_rss_config_v1 SET rights_status='blocked' WHERE source_id='motorsport-f1-news'; UPDATE source_registry_rss_config_v2 SET rights_status='blocked' WHERE source_id='motorsport-f1-news'");
   if(mode==="global_stop")db.exec("UPDATE internal_control SET global_stop_state='stopped'");
   if(mode==="writer_changed")db.exec("UPDATE internal_control SET writer_epoch=writer_epoch+1");
   if(mode==="publication_revoked")db.exec("UPDATE publication SET publication_status='emergency_stopped'");
  });
  const before=env.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n;
  expect(()=>prepareRssAutomaticDelivery(env)).toThrow();expect(env.database.prepare("SELECT count(*) n FROM generic_fence_receipt").get()!.n).toBe(before);
  expect(env.database.prepare("SELECT count(*) n FROM internal_external_attempt").get()!.n).toBe(0);
 });
 test("pending delivery blocks the next generation; terminal failure permits one replacement generation",async()=>{
  const env=await ready();const first=await runRssAutomaticCycle({...env,refine:idle});expect(first.published).toBe(1);
  env.fixtureMutation(db=>{
   db.prepare("INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) SELECT 'rss-auto-second',source_id,'guid-second',?,canonical_url||'second/',title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at FROM pending_review_candidate WHERE candidate_id=?").run(digest("second"),target.candidateId);
   db.prepare("INSERT INTO machine_summary_draft SELECT ?, 'rss-auto-second',source_revision,source_payload_hash,model,prompt_sha256,response_sha256,title_zh,summary_zh,key_points_zh_json,input_tokens,output_tokens,generated_at FROM machine_summary_draft WHERE candidate_id=?").run("draft-"+digest("second-draft"),target.candidateId);
   const secondHash=payloadHash("F1 test news","guid-second","https://www.motorsport.com/f1/news/synthetic/second/");db.prepare("UPDATE pending_review_candidate SET source_payload_hash=? WHERE candidate_id='rss-auto-second'").run(secondHash);db.prepare("UPDATE machine_summary_draft SET source_payload_hash=? WHERE candidate_id='rss-auto-second'").run(secondHash);
  });
  const blocked=await runRssAutomaticCycle({...env,refine:idle});expect(blocked.published).toBe(0);expect(blocked.items[0].reasonCode).toBe("PUBLICATION_RECONCILE_WAIT");
  env.fixtureMutation(db=>db.prepare("UPDATE projection_outbox SET status='terminal_failed',last_reason_code='SYNTHETIC_FAILED'").run());
  const replacement=await runRssAutomaticCycle({...env,refine:idle});expect(replacement,JSON.stringify(replacement)).toMatchObject({published:1});
  expect(env.database.prepare("SELECT DISTINCT snapshot_generation FROM projection_outbox").all()).toHaveLength(1);
 });

});
