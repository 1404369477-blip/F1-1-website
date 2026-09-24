// File-backed synthetic fixture. All production triggers are restored before gateway use.
import {createHash} from "node:crypto";
import {backup,DatabaseSync} from "node:sqlite";
import {chmodSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {xPageSchema12} from "./x-page-database.ts";
import {applyRssAutomaticMigration,assertRssAutomaticSchema} from "../../server/rss-automatic/migration.ts";
import {applyRssAutomaticSourceEpochMigration} from "../../server/rss-automatic/source-epoch-migration.ts";
import {RSS_AUTOMATIC_SCHEMA_SHA256} from "../../server/rss-automatic/schema-identity.ts";
import {RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256} from "../../server/rss-automatic/source-epoch-schema-identity.ts";
import {ReviewRealRepository} from "../../server/review-real/repository.ts";
import {DEEPSEEK_PROMPT_SHA256} from "../../server/rss/refinement.ts";
import {SqliteInternalOperationGateway,type OwnerProcess} from "../../server/internal-operation/gateway.ts";
import {SqliteGatewayMutationPort} from "../../server/internal-operation/mutation-port.ts";
import {persistOwnerSupervisorHandoff} from "../../server/internal-operation/owner-supervisor.ts";
import {inspectExistingPrivateDatabase,openExistingSafeDatabase} from "../../server/db/database.ts";
const ZERO="0".repeat(64),NOW="2026-09-07T00:00:00.000Z",CUTOFF="2026-09-05T02:30:00.000Z";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const payloadHash=()=>digest(JSON.stringify(["synthetic-guid","https://www.motorsport.com/f1/news/synthetic/","F1 test news","F1 test summary","Synthetic",NOW,null]));
// Isolated fixture construction; all production triggers are restored before gateway admission.
function seed(database:DatabaseSync,callback:()=>void) {
 const triggers=database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all() as Array<{name:string;sql:string}>;
 for(const row of triggers)database.exec(`DROP TRIGGER "${row.name}"`);
 try{callback();}finally{for(const row of triggers)database.exec(row.sql);}
}
export async function rssSourceEpochFixture(options:Readonly<{sourceId?:string;legacy?:boolean;withDraft?:boolean}>={}) {
 const withDraft=options.withDraft??false,stopped=false;
 const sourceId=options.sourceId??"motorsport-f1-news",sourceClock=sourceId==="motorsport-f1-news"?4:1,sourceRecovery=sourceId==="skysports-f1-news"?2:1;
 const target={candidateId:"rss-source-epoch-synthetic",sourceRevision:1,inputContentHash:payloadHash()};
 const cleanups:Array<()=>void>=[];
 let clockAt=Date.parse(NOW); const clock=()=>new Date(clockAt);
 const memory=xPageSchema12();applyRssAutomaticMigration(memory,{applyEnabled:true});
 if(!options.legacy)applyRssAutomaticSourceEpochMigration(memory,{applyEnabled:true});
 seed(memory,()=>{
  memory.prepare("UPDATE internal_control SET source_config_epoch=1,source_safety_epoch=1,authorization_version=1,policy_epoch=1,recovery_epoch=2,writer_epoch=2").run();
  memory.prepare("UPDATE source SET enabled=1,stop_epoch=? WHERE source_id=?").run(sourceClock,sourceId);
  memory.prepare("UPDATE source_registry_v1 SET enabled=1,lifecycle_status='active',collection_onboarding_status='active',source_config_epoch=?,source_safety_epoch=?,authorization_version=1,policy_epoch=1,recovery_epoch=? WHERE source_id=?").run(sourceClock,sourceClock,sourceRecovery,sourceId);
  memory.prepare("UPDATE internal_control SET phase='live',global_stop_state=?,recovery_state='ready',deletion_fence_state='clear',publication_fence_state='clear',updated_at=?,writer_authority_receipt_sha256=?").run(stopped?"stopped":"clear",NOW,"1".repeat(64));
  memory.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES(?,?,'synthetic-guid',?,'https://www.motorsport.com/f1/news/synthetic/','F1 test news','F1 test summary','Synthetic',?,?,?,?,?)`).run(target.candidateId,sourceId,digest("synthetic"),NOW,target.inputContentHash,target.sourceRevision,NOW,NOW);
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
 const gateway=new SqliteInternalOperationGateway({database:db,schemaSha256:options.legacy?RSS_AUTOMATIC_SCHEMA_SHA256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,releaseSha256:ZERO,manifestSha256:ZERO,now:clock});cleanups.push(()=>gateway.close());
 const port=(owner:OwnerProcess)=>new SqliteGatewayMutationPort({database:db,gateway,ownerProcess:owner,now:clock,handoffProvider:()=>{const h=queues.get(owner)!.shift();if(!h)throw new Error("SYNTHETIC_HANDOFF_EXHAUSTED");return h;}});
 const supervisorPort=port("system_supervisor"),reviewer=new ReviewRealRepository(db,clock,port("automatic_reviewer")),publisher=new ReviewRealRepository(db,clock,port("automatic_publisher"));
 const keyPath=join(root,"deepseek-api-key");writeFileSync(keyPath,"sk-"+"x".repeat(24),{mode:0o600});
 return {target,sourceId,path,close:()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();},database:db,gateway,supervisorPort,reviewer,publisher,port,keyPath,root,cutoffIso:CUTOFF,now:clock,advanceNow:(milliseconds:number)=>{clockAt+=milliseconds;},
  fixtureMutation:(callback:(other:DatabaseSync)=>void)=>{const other=new DatabaseSync(path);try{other.exec("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON");seed(other,()=>callback(other));}finally{other.close();}}};
}
