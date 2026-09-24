import {DatabaseSync} from "node:sqlite";
import {xCaptureSha256} from "../server/x-page/trusted-capture.ts";
import {spawnSync} from "node:child_process";
import {createPublicKey} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,describe,expect,test,vi} from "vitest";
import {openExistingSafeDatabase} from "../server/db/database.ts";
import {createReviewAdminRuntime,createAdminAutomaticRuntime,startAdminBackgroundTasks} from "../server/admin-service/runtime.ts";
import {createXPageRuntime} from "../server/x-page/runtime.ts";
import {SqliteGatewayMutationPort} from "../server/internal-operation/mutation-port.ts";
import {createRssAutomaticHandoffProvider} from "../server/rss-automatic/supervisor.ts";
import {createXPageFileEvidencePort} from "../server/x-page/capture-artifacts.ts";
import {SqliteXPageImportMutationPort} from "../server/x-page/import-port.ts";
import {SqliteXPageProducerReceiptLedger} from "../server/x-page/producer-receipt-ledger.ts";
import {importTrustedXCapture,readReadyXPageSource} from "../server/x-page/trusted-importer.ts";
import {ProjectionHttpTransport} from "../server/review-real/sender.ts";
import {canonicalJson} from "../server/db/profile.ts";
import {nextAutomaticDelivery} from "../server/review-real/automatic-delivery.ts";
import {seedRssAutomaticBackup} from "./helpers/rss-automatic-backup.ts";
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from "../server/x-page/admission-schema-identity.ts";
import {ProjectionReceiver} from "../server/review-real/projection.ts";
import {xPageServiceFixture} from "./helpers/x-page-service.ts";
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const response=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"车队分享技术进展",summaryZh:"车队在原帖介绍了赛车的技术进展。",keyPointsZh:["原帖介绍赛车技术进展"]})}}],usage:{prompt_tokens:40,completion_tokens:30}}),{status:200});
async function ready(rss=true) {
  const fixture=await xPageServiceFixture(rss);cleanups.push(fixture.cleanup);
  const fetcher=vi.fn(async()=>response());vi.stubGlobal("fetch",fetcher);
  const runtime=createReviewAdminRuntime(fixture.config);let runtimeClosed=false;const closeRuntime=()=>{if(runtimeClosed)return;runtimeClosed=true;runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();};cleanups.push(closeRuntime);
  const supervisorDatabase=openExistingSafeDatabase(fixture.databasePath,"f1plus1-rss-real-private.sqlite",fixture.config.reviewDatabaseIdentity,[10]);let supervisorClosed=false;const closeSupervisor=()=>{if(supervisorClosed)return;supervisorClosed=true;supervisorDatabase.close();};cleanups.push(closeSupervisor);
  const common={database:runtime.database,gateway:runtime.gateway!,supervisorDatabase,releaseGate:fixture.config.releaseGate!,expectedDeploymentManifestSha256:fixture.config.expectedDeploymentManifestSha256!,expectedBackupReleaseSha256:fixture.config.expectedBackupReleaseSha256!};
  const x=createXPageRuntime({...common,configurationPath:fixture.config.xPageTrustConfigurationPath!,expectedConfigurationSha256:fixture.config.xPageTrustConfigurationSha256!,releaseAppRoot:fixture.config.targetReleaseAppRoot,privateDir:fixture.privateDir,cutoffIso:fixture.config.xPageAutomaticCutoffIso!});
  const value=fixture.capture();x.admitSource("x_f1",value);fixture.live();
  const now=()=>new Date(),evidencePort=createXPageFileEvidencePort({runtimeTrust:fixture.loaded,now});
  let importSequence=0;
  const importCapture=(capture:ReturnType<typeof fixture.capture>)=>{
    const handoff=createRssAutomaticHandoffProvider({...common,ownerProcess:"x_page_importer"})();
    const port=new SqliteGatewayMutationPort({database:runtime.database,gateway:runtime.gateway!,ownerProcess:"x_page_importer",handoffProvider:()=>handoff});
    return importTrustedXCapture({database:runtime.database,gatewayPort:new SqliteXPageImportMutationPort({database:runtime.database,gatewayPort:port,trust:fixture.loaded.trust,evidencePort,now}),
      receiptLedger:new SqliteXPageProducerReceiptLedger(runtime.database),evidencePort,capture,trust:fixture.loaded.trust,expectedSourceIdentity:readReadyXPageSource(runtime.database,fixture.loaded.trust,"x_f1",now()),expectedCandidate:null,operationId:`synthetic-service-import-${++importSequence}`,now});
  };
  const result=importCapture(value);
  const receiver=new ProjectionReceiver({root:join(fixture.root,"public"),signingKeyId:fixture.config.projectionSigningKeyId,publicKey:createPublicKey(readFileSync(fixture.config.projectionSigningPrivateKeyPath))});
  const post=vi.spyOn(ProjectionHttpTransport.prototype,"post").mockImplementation(async envelope=>({kind:"response",status:200,body:receiver.receive(envelope)}));
  return {...fixture,runtime,fetcher,post,receiver,target:result,importCapture,close:()=>{closeSupervisor();closeRuntime();fixture.closeMutation();}};
}
describe("deployment-bound X plus RSS real Admin runtime",()=>{
  test("admits in paused/stopped, imports in live and fairly publishes both lanes with one sender",async()=>{
    const e=await ready();const automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    const first=await automatic.tick();expect(first,JSON.stringify(first)).toMatchObject({status:"processed",cycles:[{lane:"rss",receipt:{published:1}}]});
    expect(await automatic.tick()).toMatchObject({status:"blocked",reasonCode:"PUBLICATION_RECONCILE_WAIT"});
    expect(await e.runtime.sender.tick()).toMatchObject({outcome:"succeeded"});
    await automatic.close();e.close();
    const runtime=createReviewAdminRuntime(e.config);cleanups.push(()=>{runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();});
    const restarted=createAdminAutomaticRuntime(e.config,runtime);cleanups.push(restarted.close);
    const second=await restarted.tick();expect(second,JSON.stringify(second)).toMatchObject({status:"processed",cycles:[{lane:"x_page",receipt:{published:1}}]});
    expect(await runtime.sender.tick()).toMatchObject({outcome:"succeeded"});expect(await runtime.sender.tick()).toMatchObject({outcome:"idle"});
    expect(e.fetcher).toHaveBeenCalledTimes(1);expect(e.post).toHaveBeenCalledTimes(2);
    expect(e.receiver.readActiveSnapshot()?.snapshotGeneration).toBe(2);
    expect(JSON.parse(readFileSync(join(e.privateDir,"rss-automatic-cursor.json"),"utf8")).schemaVersion).toBe("rss-automatic-cursor-v1");
    expect(JSON.parse(readFileSync(join(e.privateDir,"x-page-automatic-cursor.json"),"utf8")).schemaVersion).toBe("x-page-automatic-cursor-v1");
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='system_supervisor' AND phase='paused' AND state='succeeded'").get()!.n).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE consumed_by_operation_id IS NULL").get()!.n).toBe(0);
  });
  test("X first then RSS preserves fair order and rejects a committed source/policy mismatch",async()=>{
    const e=await ready();
    writeFileSync(join(e.privateDir,"automatic-processing-order.json"),canonicalJson({schemaVersion:"automatic-processing-order-v1",schemaSha256:e.config.reviewSchemaSha256,
      rssCutoffIso:e.config.rssAutomaticCutoffIso,xPageCutoffIso:e.config.xPageAutomaticCutoffIso,next:"x_page"}),{mode:0o600});
    const automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    const first=await automatic.tick();expect(first,JSON.stringify(first)).toMatchObject({status:"processed",cycles:[{lane:"x_page",receipt:{published:1}}]});
    expect(nextAutomaticDelivery(e.runtime.database)?.kind).toBe("x_page");
    e.mutate(db=>db.exec("UPDATE internal_operation SET policy_id='p-publish-auto-live' WHERE policy_id='p-x-page-auto-publish-live'"));
    await expect(e.runtime.sender.tick()).rejects.toThrow("AUTOMATIC_DELIVERY_SOURCE_POLICY_MISMATCH");expect(e.post).not.toHaveBeenCalled();
    e.mutate(db=>db.exec("UPDATE internal_operation SET policy_id='p-x-page-auto-publish-live' WHERE operation_kind='publish' AND source_id='x_f1'"));
    expect(await e.runtime.sender.tick()).toMatchObject({outcome:"succeeded"});
    const second=await automatic.tick();expect(second,JSON.stringify(second)).toMatchObject({status:"processed",cycles:[{lane:"rss",receipt:{published:1}}]});
    expect(nextAutomaticDelivery(e.runtime.database)?.kind).toBe("rss");expect(await e.runtime.sender.tick()).toMatchObject({outcome:"succeeded"});
    expect(e.post).toHaveBeenCalledTimes(2);expect(e.fetcher).toHaveBeenCalledTimes(1);
    // Two real committed histories are rewound only for selector arbitration.
    e.mutate(db=>{db.exec("UPDATE projection_outbox SET status='pending'");db.exec("UPDATE projection_outbox SET status='reconcile_wait' WHERE snapshot_generation=2");});
    expect(nextAutomaticDelivery(e.runtime.database)?.kind).toBe("rss");
    const before=readFileSync(join(e.privateDir,"automatic-processing-order.json"),"utf8");
    expect(await automatic.tick()).toMatchObject({status:"blocked",reasonCode:"PUBLICATION_RECONCILE_WAIT"});
    expect(readFileSync(join(e.privateDir,"automatic-processing-order.json"),"utf8")).toBe(before);
  });
  test.each([false,true])("renews expired X delivery authority in fallback and reconciles a lost response without another POST (interrupted=%s)",async interrupted=>{
    const e=await ready(false),automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    const cycle=await automatic.tick();expect(cycle,JSON.stringify(cycle)).toMatchObject({status:"processed"});
    const head=nextAutomaticDelivery(e.runtime.database)!;expect(head.kind).toBe("x_page");
    e.post.mockImplementation(async envelope=>{e.receiver.receive(envelope);return {kind:"unknown"};});
    expect(await e.runtime.sender.tick()).toMatchObject({outcome:"reconcile_wait",deliveryId:head.deliveryId});
    const bytes=e.runtime.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox").all();
    await automatic.close();e.close();
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+16*60_000);
    e.mutate(db=>seedRssAutomaticBackup(db,{id:"x-expired-backup",schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,releaseSha256:e.config.expectedBackupReleaseSha256!,manifestSha256:e.config.expectedDeploymentManifestSha256!,nowIso:new Date().toISOString()}));e.closeMutation();
    let runtime=createReviewAdminRuntime({...e.config,releaseGate:e.pair.fallbackGate});cleanups.push(()=>{runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();});
    expect(()=>createAdminAutomaticRuntime({...e.config,releaseGate:e.pair.fallbackGate},runtime)).toThrow("ADMIN_RSS_AUTOMATIC_RELEASE_CLOSED");
    const get=vi.spyOn(ProjectionHttpTransport.prototype,"getReceipt").mockImplementation(async id=>({kind:"response",status:200,body:e.receiver.getReceipt(id)}));
    if(interrupted){
      const {ReviewRealRepository}=await import("../server/review-real/repository.ts");
      vi.spyOn(ReviewRealRepository.prototype,"markDeliverySucceeded").mockImplementationOnce(()=>{throw new Error("SYNTHETIC_STOP_BEFORE_OUTBOX");});
      await expect(runtime.sender.tick()).rejects.toThrow("SYNTHETIC_STOP_BEFORE_OUTBOX");
      runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();runtime=createReviewAdminRuntime(e.config);
    }
    expect(await runtime.sender.tick()).toMatchObject({outcome:"succeeded",deliveryId:head.deliveryId});
    expect(await runtime.sender.tick()).toMatchObject({outcome:"idle"});expect(e.post).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledTimes(1);
    expect(runtime.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox").all()).toEqual(bytes);
    expect(runtime.database.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE handoff_id LIKE 'x-page-delivery-supervisor-%' AND consumed_by_operation_id IS NOT NULL").get()!.n).toBe(5);
    expect(runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='reconciler' AND policy_id='p-x-page-reconcile-live' AND state='succeeded'").get()!.n).toBeGreaterThan(0);
  });
  test("close rejects new ticks but drains the actual in-flight model before closing its supervisor",async()=>{
    const e=await ready(false);let release:((response:Response)=>void)|undefined,started:(()=>void)|undefined;
    const start=new Promise<void>(resolve=>{started=resolve;});e.fetcher.mockImplementation(()=>{started!();return new Promise<Response>(resolve=>{release=resolve;});});
    const automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    const pending=automatic.tick();expect(automatic.tick()).toBe(pending);await start;
    let closed=false;const closing=automatic.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
    await expect(automatic.tick()).rejects.toThrow("ADMIN_AUTOMATIC_RUNTIME_CLOSED");
    release!(response());expect(await pending).toMatchObject({status:"processed"});await closing;expect(closed).toBe(true);
    expect(e.fetcher).toHaveBeenCalledTimes(1);
    expect(e.runtime.database.prepare("SELECT count(*) n FROM machine_summary_draft WHERE candidate_id=?").get(e.target.candidateId)!.n).toBe(1);
    expect(e.runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='bilingual_refiner' AND state='succeeded'").get()!.n).toBe(2);
  });

  test("a real process exit after receiver commit leaves one started POST and an expired lease that fallback reconciles by GET",async()=>{
    const e=await ready(false),automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    expect(await automatic.tick()).toMatchObject({status:"processed"});const head=nextAutomaticDelivery(e.runtime.database)!;
    await automatic.close();e.close();
    const path=join(e.root,"x-started-child.json");writeFileSync(path,JSON.stringify({config:{...e.config,releaseGate:undefined},full:e.pair.full,pair:e.pair.receipt,root:e.root}),{mode:0o600});
    const child=spawnSync(process.execPath,["--experimental-transform-types",join(e.config.targetReleaseAppRoot,"src/tests/helpers/rss-automatic-started-child.ts"),path],
      {cwd:e.config.targetReleaseAppRoot,env:{...process.env,NODE_ENV:"test"},encoding:"utf8",timeout:10_000});
    expect(child.status,child.stderr).toBe(86);
    expect(JSON.parse(readFileSync(join(e.root,"started-child-post-receipt.json"),"utf8"))).toMatchObject({deliveryId:head.deliveryId,snapshotGeneration:1});
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+16*60_000);
    e.mutate(db=>seedRssAutomaticBackup(db,{id:"x-process-restart-backup",schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,releaseSha256:e.config.expectedBackupReleaseSha256!,manifestSha256:e.config.expectedDeploymentManifestSha256!,nowIso:new Date().toISOString()}));e.closeMutation();
    const runtime=createReviewAdminRuntime({...e.config,releaseGate:e.pair.fallbackGate});cleanups.push(()=>{runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();});
    expect(runtime.database.prepare("SELECT state,external_calls FROM internal_external_attempt WHERE endpoint_class='projection_deliver'").get()).toEqual({state:"started",external_calls:1});
    expect(runtime.database.prepare("SELECT status FROM projection_outbox").get()!.status).toBe("leased");
    const receiver=new ProjectionReceiver({root:join(e.root,"started-public-projection"),signingKeyId:e.config.projectionSigningKeyId,publicKey:createPublicKey(readFileSync(e.config.projectionSigningPrivateKeyPath)),now:()=>Date.now()});
    e.post.mockImplementation(async()=>{throw new Error("SECOND_POST_FORBIDDEN");});
    const get=vi.spyOn(ProjectionHttpTransport.prototype,"getReceipt").mockImplementation(async id=>({kind:"response",status:200,body:receiver.getReceipt(id)}));
    expect(await runtime.sender.tick()).toMatchObject({outcome:"succeeded",deliveryId:head.deliveryId});
    expect(e.post).not.toHaveBeenCalled();expect(get).toHaveBeenCalledExactlyOnceWith(head.deliveryId);
    expect(runtime.database.prepare("SELECT state,outcome,external_calls FROM internal_external_attempt WHERE endpoint_class='projection_deliver'").get()).toEqual({state:"response_committed",outcome:"succeeded",external_calls:1});
    expect(await runtime.sender.tick()).toMatchObject({outcome:"idle"});expect(get).toHaveBeenCalledTimes(1);
  });

  test("deployment pins reject missing cutoffs, changed trust bytes and mismatched adapter implementation before factory opens a gateway",async()=>{
    const e=await xPageServiceFixture(false);cleanups.push(e.cleanup);
    expect(()=>createReviewAdminRuntime({...e.config,xPageAutomaticCutoffIso:undefined})).toThrow("ADMIN_X_PAGE_AUTOMATIC_CUTOFF_INVALID");
    expect(()=>createReviewAdminRuntime({...e.config,rssAutomaticCutoffIso:undefined})).toThrow("ADMIN_RSS_AUTOMATIC_CUTOFF_INVALID");
    expect(()=>createReviewAdminRuntime({...e.config,xPageTrustConfigurationSha256:"a".repeat(64)})).toThrow("ADMIN_X_PAGE_TRUST_CONFIG_IDENTITY_INVALID");
    expect(()=>createReviewAdminRuntime({...e.config,expectedDeploymentManifestSha256:undefined})).toThrow("X_CAPTURE_RUNTIME_PINS_INVALID");
    const altered=JSON.parse(readFileSync(e.config.xPageTrustConfigurationPath!,"utf8"));altered.producerTrust.adapterSha256="b".repeat(64);
    const text=canonicalJson(altered);writeFileSync(e.config.xPageTrustConfigurationPath!,text,{mode:0o600});
    expect(()=>createReviewAdminRuntime({...e.config,xPageTrustConfigurationSha256:xCaptureSha256(text)})).toThrow("X_CAPTURE_ADAPTER_IDENTITY_INVALID");
  });
  test("supervisor separates paused admission from live import and requires current exact backup proof",async()=>{
    const e=await xPageServiceFixture(false);cleanups.push(e.cleanup);const database=new DatabaseSync(e.databasePath);cleanups.push(()=>database.close());
    const common={supervisorDatabase:database,releaseGate:e.config.releaseGate!,expectedDeploymentManifestSha256:e.config.expectedDeploymentManifestSha256!,expectedBackupReleaseSha256:e.config.expectedBackupReleaseSha256!};
    expect(()=>createRssAutomaticHandoffProvider({...common,ownerProcess:"x_page_importer",purpose:"x_page_source_admission"})).toThrow("RSS_AUTO_HANDOFF_PURPOSE_INVALID");
    expect(()=>createRssAutomaticHandoffProvider({...common,ownerProcess:"x_page_importer"})()).toThrow("X_PAGE_AUTO_LIVE_REQUIRED");
    expect(()=>createRssAutomaticHandoffProvider({...common,releaseGate:e.pair.fallbackGate,ownerProcess:"system_supervisor",purpose:"x_page_source_admission"})).toThrow("RSS_AUTO_RELEASE_CLOSED");
    expect(()=>createRssAutomaticHandoffProvider({...common,expectedDeploymentManifestSha256:"c".repeat(64),ownerProcess:"system_supervisor",purpose:"x_page_source_admission"})()).toThrow("RSS_AUTO_BACKUP_REQUIRED");
    expect(()=>createRssAutomaticHandoffProvider({...common,ownerProcess:"system_supervisor",purpose:"x_page_source_admission",now:()=>new Date(Date.now()+16*60_000)})()).toThrow("RSS_AUTO_BACKUP_STALE");
    e.live();expect(()=>createRssAutomaticHandoffProvider({...common,ownerProcess:"system_supervisor",purpose:"x_page_source_admission"})()).toThrow("X_PAGE_ADMISSION_CONTROL_OPEN");
    expect(database.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE owner_process<>'backup_worker'").get()!.n).toBe(0);
  });

  test("the independent X cursor survives service restart past five blocked candidates and reaches later work",async()=>{
    const e=await ready(false),blocked=[e.target.candidateId];
    for(let index=0;index<5;index++){
      const value=e.capture({receiptId:`synthetic-cursor-${index}`,publishedAt:new Date(Date.now()-20_000-index*1000).toISOString()});
      const item=e.importCapture(value);if(index<4)blocked.push(item.candidateId);
    }
    e.mutate(db=>{for(let index=0;index<blocked.length;index++)db.prepare("UPDATE pending_review_candidate SET editor_title='人工保留',editor_based_on_source_revision=source_revision,first_seen_at=? WHERE candidate_id=?").run(new Date(Date.now()-15_000+index).toISOString(),blocked[index]);});
    const rows=e.runtime.database.prepare("SELECT candidate_id,first_seen_at,editor_title,review_status FROM pending_review_candidate WHERE first_seen_at>=? ORDER BY first_seen_at,candidate_id").all(e.config.xPageAutomaticCutoffIso!);
    expect(rows.length,JSON.stringify({rows,blocked,cutoff:e.config.xPageAutomaticCutoffIso})).toBe(6);
    expect(rows.slice(0,5).map(row=>row.candidate_id),JSON.stringify(rows)).toEqual(blocked);
    const automatic=createAdminAutomaticRuntime(e.config,e.runtime);cleanups.push(automatic.close);
    const first=await automatic.tick();expect(first,JSON.stringify(first)).toMatchObject({status:"blocked",reasonCode:"X_PAGE_AUTOMATIC_MANUAL_OVERRIDE"});
    expect(e.fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(e.privateDir,"x-page-automatic-cursor.json"),"utf8")).after.candidateId).toBe(blocked.at(-1));
    await automatic.close();e.close();
    const runtime=createReviewAdminRuntime(e.config);cleanups.push(()=>{runtime.closeBackgroundResources();runtime.gateway?.close();runtime.database.close();});
    const restarted=createAdminAutomaticRuntime(e.config,runtime);cleanups.push(restarted.close);
    const second=await restarted.tick();expect(second,JSON.stringify(second)).toMatchObject({status:"processed"});expect(e.fetcher).toHaveBeenCalledTimes(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM publication WHERE publication_status='published'").get()!.n).toBe(1);
  });

  test("the actual background stop signals closing during RSS model work and never starts the X lane after the RSS failure",async()=>{
    const e=await ready();e.mutate(db=>db.exec("DELETE FROM machine_summary_draft WHERE candidate_id='rss-service-draft'"));
    let release:(()=>void)|undefined,entered:(()=>void)|undefined;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    e.fetcher.mockImplementationOnce(async()=>{entered!();await new Promise<void>(resolve=>{release=resolve;});return new Response("{}",{status:503});});
    const automatic=createAdminAutomaticRuntime(e.config,e.runtime);
    const tasks=startAdminBackgroundTasks({senderTick:()=>e.runtime.sender.tick(),automaticEnabled:true,createAutomatic:()=>automatic});cleanups.push(tasks.stop);
    await started;let stopped=false;const stopping=tasks.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
    release!();await stopping;expect(stopped).toBe(true);expect(e.fetcher).toHaveBeenCalledTimes(1);expect(e.post).not.toHaveBeenCalled();
    expect(e.runtime.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='bilingual_refiner'").get()!.n).toBe(0);
    expect(e.runtime.database.prepare("SELECT count(*) n FROM publication").get()!.n).toBe(0);
    expect(e.runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(0);
    expect(e.runtime.database.prepare("SELECT count(*) n FROM machine_summary_draft WHERE candidate_id=?").get(e.target.candidateId)!.n).toBe(0);
    await tasks.stop();await expect(automatic.tick()).rejects.toThrow("ADMIN_AUTOMATIC_RUNTIME_CLOSED");
  });

});
