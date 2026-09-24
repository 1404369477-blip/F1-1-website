import {afterEach,describe,expect,test} from "vitest";
import {createHash} from "node:crypto";
import {canonicalJson} from "../server/db/profile.ts";
import {xPageAutomaticFixture,xPageProjectionSender} from "./helpers/x-page-automatic.ts";
import {issueXPageAutomaticFences,readXPageAutomaticContent} from "../server/x-page/content-authority.ts";
import {runXPageAutomaticCycle} from "../server/x-page/automatic-worker.ts";
import {prepareXPageAutomaticDelivery,readXPageCommittedDelivery} from "../server/x-page/delivery-authority.ts";
import {X_PAGE_REFINE_PROMPT_SHA256} from "../server/x-page/refinement.ts";
import {issueRssAutomaticFences} from "../server/rss-automatic/admission.ts";
import {refineOneCandidate} from "../server/rss/refinement.ts";

const cleanups:Array<()=>void>=[];afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
async function ready(options:Parameters<typeof xPageAutomaticFixture>[0]={}) {const e=await xPageAutomaticFixture(options);cleanups.push(e.close);return e;}
function identity(e:Awaited<ReturnType<typeof ready>>) {return {schemaSha256:e.gateway.expectedSchemaSha256(),releaseSha256:e.gateway.expectedReleaseSha256(),manifestSha256:e.gateway.expectedManifestSha256(),verifiedFullManifestSha256:null,verifiedFallbackManifestSha256:null,now:e.now()};}
describe("X complete capture automatic publication through the real file gateway",()=>{
  test("mixed X and RSS storage preserves the existing RSS-only Admin queue contract",async()=>{
    const e=await ready();expect(e.database.prepare("SELECT count(*) n FROM pending_review_candidate").get()!.n).toBe(2);
    const list=e.reviewer.list();expect(list.items.map(item=>item.candidateId)).toEqual([e.rssTarget.candidateId]);expect(list.nextCursor).toBeNull();
    expect(list.items[0].sourceDisplayName).toBe("Motorsport.com");
  });
  test("proves the exact model carrier, reviews and commits one shared outbox without media",async()=>{
    const e=await ready();expect(issueXPageAutomaticFences(e)).toEqual({issued:5,reused:0});
    await e.refine();const proof=readXPageAutomaticContent(e.database,e.target,e.now());expect(proof.draft?.titleZh).toBe("车队分享技术进展");
    const review=e.reviewer.reviewXPageAutomaticCandidate(e.target);expect(review.kind).toBe("review");
    issueXPageAutomaticFences({...e,publicationId:review.publicationId});
    const published=e.publisher.publishXPageAutomaticCandidate(e.target);expect(published.kind).toBe("publish");if(published.kind!=="publish")throw new Error("TEST_PUBLISH_REQUIRED");
    const committed=readXPageCommittedDelivery(e.database,published.deliveryId,identity(e));
    expect(committed.envelope.snapshot.records.find(record=>record.publicId===published.publicId)).toMatchObject({contentType:"driver_social",source:{platform:"x",sourceId:"x_f1"},media:null});
    expect(e.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    expect(e.reviewer.reviewXPageAutomaticCandidate(e.target)).toEqual(review);expect(e.publisher.publishXPageAutomaticCandidate(e.target)).toEqual(published);
    expect(e.modelCalls).toBe(1);expect(prepareXPageAutomaticDelivery(e)).toEqual({issued:0,reused:5});
  });
  test("worker binds both repost sources and leaves delivery to the one sender",async()=>{
    const e=await ready({repost:true,text:"Synthetic repost body."});const result=await runXPageAutomaticCycle(e);
    expect(result,result.items[0]?.reasonCode??"").toMatchObject({status:"processed",refined:1,approved:1,published:1});
    expect(e.database.prepare("SELECT count(*) n FROM internal_operation WHERE owner_process='projection_sender'").get()!.n).toBe(0);
    const sources=e.database.prepare("SELECT source_id FROM x_page_operation_source_binding_v1 WHERE operation_id LIKE 'x-page-auto-publish-%' ORDER BY source_id").all();
    expect(sources.map(row=>row.source_id)).toEqual(["x_f1","x_mclarenf1"]);
  });
  test("the unchanged sender signs and delivers X through its one existing external attempt",async()=>{
    const e=await ready(),cycle=await runXPageAutomaticCycle(e);expect(cycle.published).toBe(1);
    const delivery=xPageProjectionSender(e);const result=await delivery.sender.tick().catch(error=>{throw new Error(delivery.errors.join(";")||String(error));});expect(result).toMatchObject({outcome:"succeeded",deliveryId:cycle.deliveryId});
    expect(delivery.counts()).toEqual({posts:1,gets:0});expect(await delivery.sender.tick()).toMatchObject({outcome:"idle"});
    expect(e.database.prepare("SELECT policy_id FROM internal_operation WHERE operation_id LIKE 'projection-delivery-%'").get()!.policy_id).toBe("p-x-page-projection-live");
  });
  test("an unknown POST is reconciled once using the same committed bytes after receipt expiry",async()=>{
    const e=await ready(),cycle=await runXPageAutomaticCycle(e);expect(cycle.published).toBe(1);
    const delivery=xPageProjectionSender(e,{unknown:true});expect(await delivery.sender.tick()).toMatchObject({outcome:"reconcile_wait"});
    const before=e.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!);
    e.advanceNow(16*60_000);
    expect(await delivery.sender.tick()).toMatchObject({outcome:"succeeded",deliveryId:cycle.deliveryId});
    expect(delivery.counts()).toEqual({posts:1,gets:1});
    expect(e.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!)).toEqual(before);
    expect(e.database.prepare("SELECT policy_id FROM internal_operation WHERE owner_process='reconciler' AND operation_kind='reconcile'").get()!.policy_id).toBe("p-x-page-reconcile-live");
  });
  test("a matching synthetic draft row without a successful model/store carrier cannot approve",async()=>{
    const e=await ready(),draftId=`draft-${createHash("sha256").update(canonicalJson({target:e.target,model:"deepseek-chat",promptSha256:X_PAGE_REFINE_PROMPT_SHA256})).digest("hex")}`;
    e.fixtureMutation(database=>database.prepare("INSERT INTO machine_summary_draft VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(draftId,e.target.candidateId,1,e.target.inputContentHash,"deepseek-chat",X_PAGE_REFINE_PROMPT_SHA256,"b".repeat(64),"伪造的中文标题","伪造的中文摘要不得进入审核。",'["伪造要点"]',1,1,e.now().toISOString()));
    const result=await runXPageAutomaticCycle(e);expect(result.items[0]?.reasonCode).toBe("X_PAGE_AUTOMATIC_DRAFT_UNPROVEN");
    expect(e.modelCalls).toBe(0);expect(e.database.prepare("SELECT count(*) n FROM review_bundle").get()!.n).toBe(0);
  });
  test("a late complete-body edit invalidates the earlier draft and review target",async()=>{
    const e=await ready();issueXPageAutomaticFences(e);await e.refine();
    e.advanceNow(1000);const edited=e.capture({text:e.initialCapture.post.text+" Added after the first 1000 characters.",receiptId:"test-edited-capture",observedAt:e.now().toISOString()});
    const next=e.importCapture(edited,{sourceRevision:1,sourceVersionHash:e.target.inputContentHash});expect(next.sourceRevision).toBe(2);
    expect(()=>e.reviewer.reviewXPageAutomaticCandidate(e.target)).toThrow("X_PAGE_AUTOMATIC_SOURCE_STALE");
    expect(e.database.prepare("SELECT count(*) n FROM review_bundle").get()!.n).toBe(0);
  });
  test.each(["manual_edit","manual_reject"] as const)("preserves %s against automatic approval and publish",async mode=>{
    const e=await ready();issueXPageAutomaticFences(e);await e.refine();
    if(mode==="manual_edit")e.fixtureMutation(database=>database.prepare("UPDATE pending_review_candidate SET editor_title='人工标题',editor_excerpt='人工摘要',editor_notes='人工备注',editor_based_on_source_revision=source_revision WHERE candidate_id=?").run(e.target.candidateId));
    else e.fixtureMutation(database=>database.prepare("UPDATE pending_review_candidate SET review_status='rejected' WHERE candidate_id=?").run(e.target.candidateId));
    expect(()=>e.reviewer.reviewXPageAutomaticCandidate(e.target)).toThrow("X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    expect(()=>e.publisher.publishXPageAutomaticCandidate(e.target)).toThrow("X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    expect(e.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(0);
  });
  test("manual edits after an automatic approval block publication of that bundle",async()=>{
    const e=await ready();issueXPageAutomaticFences(e);await e.refine();const review=e.reviewer.reviewXPageAutomaticCandidate(e.target);
    e.fixtureMutation(database=>database.prepare("UPDATE pending_review_candidate SET editor_title='人工重新编辑' WHERE candidate_id=?").run(e.target.candidateId));
    expect(()=>issueXPageAutomaticFences({...e,publicationId:review.publicationId})).toThrow("X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    expect(()=>e.publisher.publishXPageAutomaticCandidate(e.target)).toThrow("X_PAGE_AUTOMATIC_MANUAL_OVERRIDE");
    expect(e.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(0);
  });
  test.each(["disabled","expired","rights_unknown","observed_stopped"] as const)("%s blocks before a model call",async mode=>{
    const e=await ready({repost:true});
    if(mode==="expired")e.advanceNow(25*60*60_000);
    else e.fixtureMutation(database=>{
      if(mode==="disabled")database.prepare("UPDATE source SET enabled=0 WHERE source_id='x_f1'").run();
      if(mode==="rights_unknown")database.prepare("UPDATE x_page_source_config_v1 SET evidence_class='admission_required',adapter_sha256=NULL,authorization_receipt_sha256=NULL,authorization_expires_at=NULL,source_policy_sha256=NULL,rights_status='unknown',admission_id=NULL WHERE source_id='x_f1'").run();
      if(mode==="observed_stopped")database.prepare("UPDATE source_registry_v1 SET source_stop_status='manual' WHERE source_id='x_mclarenf1'").run();
    });
    const result=await runXPageAutomaticCycle(e);expect(result.status).toBe("blocked");expect(result.approved).toBe(0);expect(e.modelCalls).toBe(0);
  });
  test("source permission changes during a paid response prevent draft storage and another POST",async()=>{
    let changeSource=()=>{};
    const e=await ready({fetcher:async()=>{changeSource();return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"来源变更测试",summaryZh:"这个响应必须在来源变更后停止落盘。",keyPointsZh:[]})}}]}),{status:200});}});
    changeSource=()=>e.fixtureMutation(database=>database.prepare("UPDATE source_registry_v1 SET source_safety_epoch=source_safety_epoch+1 WHERE source_id='x_f1'").run());
    const first=await runXPageAutomaticCycle(e);expect(first.published).toBe(0);expect(e.modelCalls).toBe(1);
    expect(e.database.prepare("SELECT count(*) n FROM machine_summary_draft WHERE candidate_id=?").get(e.target.candidateId)!.n).toBe(0);
    await runXPageAutomaticCycle(e);expect(e.modelCalls).toBe(1);
  });
  test("a committed older capture remains deliverable after a newer text revision arrives",async()=>{
    const e=await ready(),cycle=await runXPageAutomaticCycle(e);expect(cycle.published).toBe(1);
    const before=e.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!);
    e.advanceNow(1000);const changed=e.capture({text:e.initialCapture.post.text+" A newer source revision.",receiptId:"newer-after-publication",observedAt:e.now().toISOString()});
    const imported=e.importCapture(changed,{sourceRevision:1,sourceVersionHash:e.target.inputContentHash});expect(imported.sourceRevision).toBe(2);
    const proof=readXPageCommittedDelivery(e.database,cycle.deliveryId!,identity(e));expect(proof.content.verified.normalized.text).toBe(e.initialCapture.post.text.trim());
    const delivery=xPageProjectionSender(e);const result=await delivery.sender.tick().catch(error=>{throw new Error(delivery.errors.join(";")||String(error));});
    expect(result).toMatchObject({outcome:"succeeded"});expect(delivery.counts()).toEqual({posts:1,gets:0});
    expect(e.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(cycle.deliveryId!)).toEqual(before);
  });
  test("an observed repost source changing after publish revokes delivery without a POST",async()=>{
    const e=await ready({repost:true}),cycle=await runXPageAutomaticCycle(e);expect(cycle.published).toBe(1);
    e.fixtureMutation(database=>database.prepare("UPDATE source_registry_v1 SET source_safety_epoch=source_safety_epoch+1 WHERE source_id='x_mclarenf1'").run());
    const delivery=xPageProjectionSender(e);await expect(delivery.sender.tick()).rejects.toThrow("X_PAGE_OPERATION_SOURCE_STALE");expect(delivery.counts()).toEqual({posts:0,gets:0});
  });
  test("RSS and X share the same generation arbiter and sender without changing the prior X bytes",async()=>{
    const e=await ready(),xCycle=await runXPageAutomaticCycle(e);expect(xCycle.published).toBe(1);
    e.advanceNow(1000);const rss={...e,target:e.rssTarget};issueRssAutomaticFences(rss);
    await refineOneCandidate({database:e.database,mutationPort:e.port("rss_refiner"),target:e.rssTarget,apiKeyPath:e.keyPath,budgetAccountId:"acct-rss",now:e.now,
      fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({titleZh:"现有RSS中文标题",summaryZh:"这条现有RSS新闻继续使用原有审核和公开字段。",keyPointsZh:["共同使用下一代快照"]})}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200})});
    const rssReview=e.reviewer.reviewAutomaticCandidate(e.rssTarget);issueRssAutomaticFences({...rss,publicationId:rssReview.publicationId});
    expect(()=>e.publisher.publishAutomaticCandidate(e.rssTarget)).toThrow("PUBLICATION_RECONCILE_WAIT");
    expect(e.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    const xProjection=e.database.prepare("SELECT projection_json FROM published_projection WHERE public_id LIKE 'public-x-%'").get()!.projection_json;
    const delivery=xPageProjectionSender(e);expect(await delivery.sender.tick()).toMatchObject({outcome:"succeeded"});
    const rssPublication=e.publisher.publishAutomaticCandidate(e.rssTarget);if(rssPublication.kind!=="publish")throw new Error("TEST_PUBLISH_REQUIRED");
    expect(rssPublication.generation).toBe(2);expect(e.database.prepare("SELECT projection_json FROM published_projection WHERE public_id LIKE 'public-x-%'").get()!.projection_json).toBe(xProjection);
    e.advanceNow(1000);expect(await delivery.sender.tick()).toMatchObject({outcome:"succeeded"});expect(delivery.counts()).toEqual({posts:2,gets:0});
  });
});
