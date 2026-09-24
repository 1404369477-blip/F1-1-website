import {spawnSync} from "node:child_process";
import {existsSync,readFileSync,unlinkSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach,describe,expect,test,vi} from "vitest";
import {openExistingSafeDatabase} from "../server/db/database.ts";
import {canonicalJson} from "../server/db/profile.ts";
import {openReviewAdminDatabase,runXPageCaptureImport,type AdminRuntimeConfig} from "../server/admin-service/runtime.ts";
import {SqliteInternalOperationGateway} from "../server/internal-operation/gateway.ts";
import {createXPageRuntime} from "../server/x-page/runtime.ts";
import {xCaptureSha256} from "../server/x-page/trusted-capture.ts";
import {RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256} from "../server/rss-automatic/source-epoch-schema-identity.ts";
import {xPageServiceFixture} from "./helpers/x-page-service.ts";

const cleanups:Array<()=>void>=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();for(const cleanup of cleanups.splice(0).reverse())cleanup();});
async function ready(admit=true) {
  const fixture=await xPageServiceFixture(false);cleanups.push(fixture.cleanup);
  const value=fixture.capture();
  if(admit){
    const runtime=openReviewAdminDatabase({...fixture.config,requiredSchemaVersion:10,requiredSchemaSha256:fixture.config.reviewSchemaSha256});
    const supervisorDatabase=openExistingSafeDatabase(fixture.databasePath,"f1plus1-rss-real-private.sqlite",fixture.config.reviewDatabaseIdentity,[10]);
    try {
      createXPageRuntime({database:runtime.database,gateway:runtime.gateway!,supervisorDatabase,releaseGate:fixture.config.releaseGate!,
        expectedDeploymentManifestSha256:fixture.config.expectedDeploymentManifestSha256!,expectedBackupReleaseSha256:fixture.config.expectedBackupReleaseSha256!,
        configurationPath:fixture.config.xPageTrustConfigurationPath!,expectedConfigurationSha256:fixture.config.xPageTrustConfigurationSha256!,
        releaseAppRoot:fixture.config.targetReleaseAppRoot,privateDir:fixture.privateDir,cutoffIso:fixture.config.xPageAutomaticCutoffIso!}).admitSource("x_f1",value);
    } finally {supervisorDatabase.close();runtime.gateway?.close();runtime.database.close();}
  }
  fixture.live();fixture.closeMutation();
  const fetcher=vi.fn(()=>{throw new Error("UNEXPECTED_NETWORK");});vi.stubGlobal("fetch",fetcher);
  const read=<T>(callback:(db:DatabaseSync)=>T)=>{const db=new DatabaseSync(fixture.databasePath);try{return callback(db);}finally{db.close();}};
  const snapshot=()=>read(db=>Object.fromEntries(["pending_review_candidate","x_page_candidate_capture_v1","x_page_producer_receipt_v1",
    "internal_operation","owner_authorization_handoff","internal_external_attempt","machine_summary_draft","publication","projection_outbox",
    "source","source_registry_v1","x_page_source_admission_v1","internal_control"].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()])));
  return {...fixture,value,hash:xCaptureSha256(canonicalJson(value)),read,snapshot,fetcher};
}

/** Observe every actual connection used by the operator, then prove it is closed
 * on return/throw. The fixture's inspection connections are outside this scope. */
function invoke(config:AdminRuntimeConfig,hash:string) {
  const used=new Set<DatabaseSync>(),original=DatabaseSync.prototype.prepare;
  const probe=vi.spyOn(DatabaseSync.prototype,"prepare").mockImplementation(function(this:DatabaseSync,...args){used.add(this);return original.apply(this,args);});
  try{return runXPageCaptureImport(config,hash);}
  finally{probe.mockRestore();for(const db of used)expect(()=>db.prepare("SELECT 1")).toThrow();}
}

describe("deployment-owned capture hash operator",()=>{
  test("commits once, closes both connections and replays the durable result after a lost response without another grant",async()=>{
    const e=await ready();
    // No model credential is needed by the import-only operator.
    unlinkSync(join(e.privateDir,"deepseek-api-key"));
    const before=e.snapshot(),result=invoke(e.config,e.hash),committed=e.snapshot();
    expect(result).toMatchObject({decision:"created",sourceId:"x_f1",sourceRevision:1,captureSha256:e.hash,operationId:`x-page-import-${e.hash}`});
    // Discard the first response and reopen through the operator factory.
    expect(invoke(e.config,e.hash)).toEqual(result);expect(e.snapshot()).toEqual(committed);
    expect(committed.pending_review_candidate.length-before.pending_review_candidate.length).toBe(1);
    expect(committed.x_page_candidate_capture_v1).toHaveLength(1);expect(committed.x_page_producer_receipt_v1).toHaveLength(1);
    expect(committed.owner_authorization_handoff.length-before.owner_authorization_handoff.length).toBe(1);
    expect(committed.owner_authorization_handoff.filter(row=>row.consumed_by_operation_id===null)).toHaveLength(0);
    expect(committed.internal_external_attempt).toHaveLength(0);expect(committed.machine_summary_draft).toHaveLength(0);
    expect(committed.publication).toHaveLength(0);expect(committed.projection_outbox).toHaveLength(0);
    expect(committed.source).toEqual(before.source);expect(committed.source_registry_v1).toEqual(before.source_registry_v1);
    expect(committed.x_page_source_admission_v1).toEqual(before.x_page_source_admission_v1);expect(committed.internal_control).toEqual(before.internal_control);
    expect(existsSync(join(e.privateDir,"x-page-import.lock"))).toBe(false);
    expect(existsSync(join(e.privateDir,"x-page-automatic-cursor.json"))).toBe(false);expect(e.fetcher).not.toHaveBeenCalled();
  });

  test("imports a newer capture using the current database version and preserves both receipt results",async()=>{
    const e=await ready(),first=invoke(e.config,e.hash);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+3000);
    const changed=e.capture({text:"An updated complete original post",publishedAt:e.value.post.publishedAt}),hash=xCaptureSha256(canonicalJson(changed));
    const updated=invoke(e.config,hash);expect(updated).toMatchObject({decision:"updated",candidateId:first.candidateId,sourceRevision:2,captureSha256:hash});
    const committed=e.snapshot();expect(invoke(e.config,e.hash)).toEqual(first);expect(invoke(e.config,hash)).toEqual(updated);
    expect(e.snapshot()).toEqual(committed);expect(committed.pending_review_candidate).toHaveLength(1);
    expect(committed.x_page_candidate_capture_v1).toHaveLength(2);expect(committed.x_page_producer_receipt_v1).toHaveLength(2);
    expect(committed.owner_authorization_handoff.filter(row=>row.consumed_by_operation_id===null)).toHaveLength(0);
    expect(e.fetcher).not.toHaveBeenCalled();
  });

  test.each(["hash","missing-capture","missing-graph","tamper","expired","unadmitted","old-schema","fallback","deployment","trust-pin","backup-pin","full-pin","fallback-pin","closed-control"])("rejects %s with zero business or grant writes and closes resources",async scenario=>{
    const e=await ready(scenario!=="unadmitted");let config=e.config,hash=e.hash;
    if(scenario==="hash")hash="../"+e.hash;
    if(scenario==="missing-capture")unlinkSync(join(e.loaded.artifactRoot.path,"captures",`${e.hash}.json`));
    if(scenario==="missing-graph")unlinkSync(join(e.loaded.artifactRoot.path,"tool-receipts",`${e.value.evidence.toolReceiptSha256}.json`));
    if(scenario==="tamper")writeFileSync(join(e.loaded.artifactRoot.path,"captures",`${e.hash}.json`),canonicalJson({...e.value,signature:"a".repeat(86)}),{mode:0o600});
    if(scenario==="expired"){vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+2*86_400_000);}
    if(scenario==="old-schema")config={...config,reviewSchemaSha256:RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256};
    if(scenario==="fallback")config={...config,releaseGate:e.pair.fallbackGate};
    if(scenario==="deployment")config={...config,expectedDeploymentManifestSha256:"e".repeat(64)};
    if(scenario==="trust-pin")config={...config,xPageTrustConfigurationSha256:"f".repeat(64)};
    if(scenario==="backup-pin")config={...config,expectedBackupReleaseSha256:"d".repeat(64)};
    if(scenario==="full-pin")config={...config,verifiedRssAutomaticFullManifestSha256:"b".repeat(64)};
    if(scenario==="fallback-pin")config={...config,verifiedRssAutomaticFallbackManifestSha256:undefined};
    if(scenario==="closed-control"){e.mutate(db=>db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));e.closeMutation();}
    const before=e.snapshot();expect(()=>invoke(config,hash)).toThrow();expect(e.snapshot()).toEqual(before);
    expect(existsSync(join(e.privateDir,"x-page-import.lock"))).toBe(false);expect(e.fetcher).not.toHaveBeenCalled();
  });

  test("rejects physically old schema and a concurrent import lock before any grant",async()=>{
    const e=await ready(),before=e.snapshot(),lock=join(e.privateDir,"x-page-import.lock");
    writeFileSync(lock,"held by another operator",{mode:0o600});
    expect(()=>invoke(e.config,e.hash)).toThrow("CREDENTIAL_BUSY");expect(e.snapshot()).toEqual(before);expect(readFileSync(lock,"utf8")).toBe("held by another operator");unlinkSync(lock);
    e.mutate(db=>db.exec("PRAGMA user_version=9"));e.closeMutation();
    expect(()=>invoke(e.config,e.hash)).toThrow();expect(e.snapshot()).toEqual(before);expect(e.fetcher).not.toHaveBeenCalled();
  });

  test("rereads the candidate version internally and rechecks CAS inside the real admission transaction",async()=>{
    const e=await ready(),created=invoke(e.config,e.hash);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+3000);
    const changed=e.capture({text:"A newer complete original post",publishedAt:e.value.post.publishedAt}),hash=xCaptureSha256(canonicalJson(changed));
    const original=SqliteInternalOperationGateway.prototype.runAtomicAdmission;
    const probe=vi.spyOn(SqliteInternalOperationGateway.prototype,"runAtomicAdmission").mockImplementationOnce(function(this:SqliteInternalOperationGateway,callback){
      e.mutate(db=>db.prepare("UPDATE pending_review_candidate SET source_revision=source_revision+1 WHERE candidate_id=?").run(created.candidateId));e.closeMutation();
      return original.call(this,callback);
    });
    expect(()=>invoke(e.config,hash)).toThrow("X_IMPORT_CANDIDATE_STALE");probe.mockRestore();
    expect(e.read(db=>db.prepare("SELECT count(*) n FROM x_page_producer_receipt_v1").get()!.n)).toBe(1);
    expect(e.read(db=>db.prepare("SELECT count(*) n FROM x_page_candidate_capture_v1").get()!.n)).toBe(1);
    expect(existsSync(join(e.privateDir,"x-page-import.lock"))).toBe(false);expect(e.fetcher).not.toHaveBeenCalled();
  });

  test("the actual CLI rejects raw JSON, arbitrary paths, trust arguments and malformed import hashes",()=>{
    const script=new URL("../../scripts/admin-service.ts",import.meta.url).pathname;
    for(const args of [["--manifest","/missing","--x-page-import","{}"],["--manifest","/missing","--x-page-import","/tmp/capture.json"],
      ["--manifest","/missing","--x-page-import","a".repeat(64),"--trust","/tmp/trust.json"],["--manifest","relative","--x-page-import","a".repeat(64)]]){
      const child=spawnSync(process.execPath,["--experimental-transform-types",script,...args],{encoding:"utf8",timeout:10_000,env:{...process.env,NODE_ENV:"test"}});
      expect(child.status,child.stderr).toBe(1);expect(child.stdout).toBe("");expect(child.stderr).toContain('"reasonCode":"CLI_ARGUMENTS_FORBIDDEN"');
    }
  });
});
