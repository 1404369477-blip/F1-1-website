import {randomBytes} from "node:crypto";
import {join,resolve} from "node:path";
import type {DatabaseSync} from "node:sqlite";
import type {SqliteInternalOperationGateway} from "../internal-operation/gateway.ts";
import {SqliteGatewayMutationPort} from "../internal-operation/mutation-port.ts";
import type {ReleaseRuntimeGate} from "../internal-operation/release.ts";
import {ReviewRealRepository} from "../review-real/repository.ts";
import {createRssAutomaticHandoffProvider} from "../rss-automatic/supervisor.ts";
import {readRefinementModelConfig} from "../rss/refine-model.ts";
import {withPrivateFileLock} from "../rss/private-credential-file.ts";
import {assertXCaptureArtifactRoot,loadXPageRuntimeTrust} from "./deployment-trust.ts";
import {createXPageFileEvidencePort} from "./capture-artifacts.ts";
import {SqliteXPageProducerReceiptLedger} from "./producer-receipt-ledger.ts";
import {createXPageModelGateway} from "./model-transport.ts";
import {refineOneXCandidate} from "./refinement.ts";
import {runXPageAutomaticCycle} from "./automatic-worker.ts";
import {createXPageAutomaticCursorStore} from "./cursor.ts";
import {admitTrustedXPageSource} from "./source-authority.ts";
import {verifyTrustedXCapture,verifyXCaptureArtifacts,xCaptureSha256} from "./trusted-capture.ts";
import {readXCapturePrivateFile} from "./private-artifact-file.ts";
import {SqliteXPageImportMutationPort} from "./import-port.ts";
import {importTrustedXCapture,readReadyXPageSource} from "./trusted-importer.ts";
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from "./admission-schema-identity.ts";

/** Deployment-owned assembly: no request trust, verifier booleans, injected
 * fetcher or test transport. Production uses the gateway's real started handle. */
export function createXPageRuntime(input:Readonly<{
  database:DatabaseSync;gateway:SqliteInternalOperationGateway;supervisorDatabase:DatabaseSync;releaseGate:ReleaseRuntimeGate;
  expectedDeploymentManifestSha256:string;expectedBackupReleaseSha256:string;configurationPath:string;expectedConfigurationSha256:string;
  releaseAppRoot:string;privateDir:string;cutoffIso:string;
}>) {
  if(input.gateway.expectedSchemaSha256()!==X_PAGE_ADMISSION_SCHEMA_SHA256 || input.releaseGate.receipt.schemaSha256!==X_PAGE_ADMISSION_SCHEMA_SHA256
    || input.releaseGate.receipt.role!=="full_v10" || !input.releaseGate.allows("automatic_review") || !input.releaseGate.allows("automatic_publish"))throw new Error("ADMIN_X_PAGE_AUTOMATIC_RELEASE_CLOSED");
  const loaded=loadXPageRuntimeTrust(input),now=()=>new Date();
  const evidencePort=createXPageFileEvidencePort({runtimeTrust:loaded,now}),receiptLedger=new SqliteXPageProducerReceiptLedger(input.database);
  const port=(ownerProcess:Parameters<typeof createRssAutomaticHandoffProvider>[0]["ownerProcess"],purpose?:Parameters<typeof createRssAutomaticHandoffProvider>[0]["purpose"])=>new SqliteGatewayMutationPort({
    database:input.database,gateway:input.gateway,ownerProcess,handoffProvider:createRssAutomaticHandoffProvider({...input,ownerProcess,purpose})
  });
  const supervisorPort=port("system_supervisor"),refinerPort=port("bilingual_refiner");
  const reviewer=new ReviewRealRepository(input.database,now,port("automatic_reviewer")),publisher=new ReviewRealRepository(input.database,now,port("automatic_publisher"));
  const model=createXPageModelGateway({externalPort:refinerPort,privateDir:input.privateDir});
  const cursorStore=createXPageAutomaticCursorStore({privateDir:input.privateDir});
  return Object.freeze({
    importCapture:(captureSha256:string)=>{
      if(!/^[0-9a-f]{64}$/.test(captureSha256))throw new Error("X_PAGE_IMPORT_CAPTURE_HASH_INVALID");
      // Serialize operator retries before issuing a one-use grant. A committed
      // receipt is replayed through the importer without creating another grant.
      return withPrivateFileLock(join(resolve(input.privateDir),"x-page-import.lock"),()=>{
        assertXCaptureArtifactRoot(loaded.artifactRoot);
        const file=readXCapturePrivateFile(join(loaded.artifactRoot.path,"captures",`${captureSha256}.json`),256*1024);
        if(!file)throw new Error("X_CAPTURE_ARTIFACT_MISSING");
        if(xCaptureSha256(file.text)!==captureSha256)throw new Error("X_CAPTURE_ARTIFACT_HASH_MISMATCH");
        let capture:unknown;
        try{capture=JSON.parse(file.text);}catch{throw new Error("X_CAPTURE_ARTIFACT_JSON_INVALID");}
        const verified=verifyTrustedXCapture({capture,trust:loaded.trust,now:now()});
        verifyXCaptureArtifacts(verified,evidencePort);
        const evidence=verified.capture.evidence;
        const expectedSourceIdentity=readReadyXPageSource(input.database,loaded.trust,evidence.sourceId,now());
        readReadyXPageSource(input.database,loaded.trust,evidence.observedSourceId,now());
        const current=input.database.prepare("SELECT source_revision,source_payload_hash FROM pending_review_candidate WHERE candidate_id=?")
          .get(`xpage-${verified.normalized.identity}`);
        const expectedCandidate=current?{sourceRevision:Number(current.source_revision),sourceVersionHash:String(current.source_payload_hash)}:null;
        const priorReceipt=receiptLedger.read(evidence.producerId,evidence.receiptId);
        const handoff=priorReceipt===null?createRssAutomaticHandoffProvider({...input,ownerProcess:"x_page_importer"})():null;
        const gatewayPort=new SqliteGatewayMutationPort({database:input.database,gateway:input.gateway,ownerProcess:"x_page_importer",
          handoffProvider:()=>{if(handoff===null)throw new Error("X_PAGE_IMPORT_REPLAY_GRANT_FORBIDDEN");return handoff;}});
        const importPort=new SqliteXPageImportMutationPort({database:input.database,gatewayPort,trust:loaded.trust,evidencePort,now});
        return importTrustedXCapture({database:input.database,gatewayPort:importPort,receiptLedger,evidencePort,capture,trust:loaded.trust,
          expectedSourceIdentity,expectedCandidate,operationId:`x-page-import-${captureSha256}`,now});
      });
    },
    tick:async()=>{
      const selection=readRefinementModelConfig(join(resolve(input.privateDir),"refinement-model.json"));
      return await runXPageAutomaticCycle({...input,supervisorPort,reviewer,publisher,cursorStore,limit:5,now,
        refine:target=>refineOneXCandidate({...input,target,trust:loaded.trust,receiptLedger,evidencePort,mutationPort:refinerPort,
          ...model,modelId:selection.modelId,budgetAccountId:"acct-rss",now})});
    },
    admitSource:(sourceId:string,capture:unknown)=>{
      const source=input.database.prepare("SELECT revision FROM source_registry_v1 WHERE source_id=?").get(sourceId);
      if(!source)throw new Error("X_PAGE_SOURCE_MISSING");
      verifyXCaptureArtifacts(verifyTrustedXCapture({capture,trust:loaded.trust,now:now()}),evidencePort);
      // Admission opens an atomic writer before requesting its port. Issue one
      // short-lived grant before that lock so the separate supervisor can write.
      const handoff=createRssAutomaticHandoffProvider({...input,ownerProcess:"system_supervisor",purpose:"x_page_source_admission"})();
      const admissionPort=new SqliteGatewayMutationPort({database:input.database,gateway:input.gateway,ownerProcess:"system_supervisor",handoffProvider:()=>handoff});
      return admitTrustedXPageSource({...input,gatewayPort:admissionPort,trust:loaded.trust,evidencePort,capture,sourceId,
        expectedRegistryRevision:Number(source.revision),operationId:`x-page-admit-${randomBytes(24).toString("hex")}`,now});
    }
  });
}
