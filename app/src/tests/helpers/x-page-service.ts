// Synthetic signed artifacts, release and backup proofs only. This fixture runs
// actual Admin factories, private file readers and the real file-backed gateway.
import {generateKeyPairSync,sign} from "node:crypto";
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import type {AdminRuntimeConfig} from "../../server/admin-service/runtime.ts";
import {canonicalJson} from "../../server/db/profile.ts";
import {rssAutomaticServiceFixture} from "./rss-automatic-service-fixture.ts";
import {xPageReleasePair} from "./x-page-release.ts";
import {seedRssAutomaticBackup,withRssSyntheticSeed} from "./rss-automatic-backup.ts";
import {RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256} from "../../server/rss-automatic/source-epoch-schema-identity.ts";
import {X_PAGE_ADMISSION_SCHEMA_SHA256} from "../../server/x-page/admission-schema-identity.ts";
import {applyXPageAdmissionMigration,xPageSelectedIdentity} from "../../server/x-page/admission-migration.ts";
import {testXProducer} from "./x-page-trusted.ts";
import {xCaptureSha256} from "../../server/x-page/trusted-capture.ts";
import {loadXPageRuntimeTrust} from "../../server/x-page/deployment-trust.ts";
import {xPageArtifactVerifierSigningBytes,type XPageArtifactVerifierPayload} from "../../server/x-page/capture-artifacts.ts";
const APP_ROOT=new URL("../../../",import.meta.url).pathname.replace(/\/$/,"");
export async function xPageServiceFixture(rssDraft=true) {
  const pair=xPageReleasePair(APP_ROOT),base=xPageReleasePair(APP_ROOT,RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
  const fixture=await rssAutomaticServiceFixture(base.fullGate,rssDraft,base.receipt.fallbackManifestSha256);
  let mutationDatabase:DatabaseSync|undefined;
  const mutate=(callback:(database:DatabaseSync)=>void)=>{mutationDatabase??=new DatabaseSync(fixture.databasePath);mutationDatabase.exec("PRAGMA foreign_keys=ON");withRssSyntheticSeed(mutationDatabase,()=>callback(mutationDatabase!));};
  const closeMutation=()=>{mutationDatabase?.close();mutationDatabase=undefined;};
  const file=new DatabaseSync(fixture.databasePath);file.exec("PRAGMA foreign_keys=ON");
  withRssSyntheticSeed(file,()=>file.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
  withRssSyntheticSeed(file,()=>file.prepare("INSERT INTO route_registry VALUES('route-deepseek','model','model_https','model_refine',?,?,?,'active',1)").run(xCaptureSha256("https://api.deepseek.com/chat/completions"),"0".repeat(64),"0".repeat(64)));
  applyXPageAdmissionMigration(file,{applyEnabled:true,appliedAt:new Date().toISOString()});
  seedRssAutomaticBackup(file,{id:"x-runtime-synthetic-backup",schemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,
    releaseSha256:pair.fullGate.receipt.manifestSha256,manifestSha256:fixture.config.expectedDeploymentManifestSha256!,nowIso:new Date(Date.now()-1000).toISOString()});file.close();
  const put=(path:string,value:unknown)=>{mkdirSync(join(path,".."),{recursive:true,mode:0o700});const text=typeof value==="string"?value:canonicalJson(value);writeFileSync(path,text,{mode:0o600});return xCaptureSha256(text);};
  const producer=testXProducer(),verifier=generateKeyPairSync("ed25519"),artifactRoot=join(fixture.privateDir,"x-artifacts");mkdirSync(artifactRoot,{mode:0o700});
  const adapterRelativePath="src/server/x-page/normalize.ts",adapterSha256=xCaptureSha256(readFileSync(join(APP_ROOT,adapterRelativePath))),stat=lstatSync(artifactRoot);
  const key=(name:string,value:typeof verifier.publicKey)=>{const path=join(fixture.privateDir,name);return {path,rawSha256:put(path,value.export({type:"spki",format:"pem"}).toString()),spkiSha256:xCaptureSha256(value.export({type:"spki",format:"der"}))};};
  const {publicKey:_key,deploymentManifestSha256:_deployment,...trust}=producer.trust;void _key;void _deployment;
  const trustTime=Date.now();
  const configData={schemaVersion:"x-page-runtime-trust-config-v1",producerTrust:{...trust,authorizedAt:new Date(trustTime-86_400_000).toISOString(),expiresAt:new Date(trustTime+86_400_000).toISOString(),adapterSha256,sources:trust.sources.map(source=>({...source,identitySha256:xPageSelectedIdentity(source.sourceId)}))},
    producerPublicKey:key("x-producer.pem",producer.keys.publicKey),verifier:{verifierId:"synthetic-file-verifier",keyId:"synthetic-key",publicKey:key("x-verifier.pem",verifier.publicKey)},
    adapterRelativePath,toolId:"codex-browser-visible-dom-v1",artifactFormat:"utf8-json-visible-dom-v1",artifactRoot:{path:artifactRoot,device:stat.dev,inode:stat.ino}};
  const configPath=join(fixture.privateDir,"x-trust.json"),configSha256=put(configPath,configData);
  const config:AdminRuntimeConfig={...fixture.config,reviewSchemaSha256:X_PAGE_ADMISSION_SCHEMA_SHA256,releaseGate:pair.fullGate,
    expectedBackupReleaseSha256:pair.fullGate.receipt.manifestSha256,verifiedRssAutomaticFullManifestSha256:pair.receipt.fullManifestSha256,
    verifiedRssAutomaticFallbackManifestSha256:pair.receipt.fallbackManifestSha256,xPageAutomaticCutoffIso:new Date(Date.now()-60_000).toISOString(),
    xPageTrustConfigurationPath:configPath,xPageTrustConfigurationSha256:configSha256};
  const loaded=loadXPageRuntimeTrust({configurationPath:configPath,expectedConfigurationSha256:configSha256,expectedDeploymentManifestSha256:config.expectedDeploymentManifestSha256!,releaseAppRoot:APP_ROOT});
  put(join(fixture.privateDir,"deepseek-api-key"),`sk-${"x".repeat(24)}`);
  let sequence=0;
  const capture=(options:Parameters<typeof producer.capture>[0]={})=>{
    const at=new Date(Date.now()-1000).toISOString(),id=`synthetic-service-capture-${++sequence}`;
    const original=producer.capture({observedAt:at,publishedAt:at,receiptId:id,...options}),evidence={...original.evidence,adapterSha256,
      deploymentManifestSha256:config.expectedDeploymentManifestSha256!,sourceIdentitySha256:xPageSelectedIdentity(original.evidence.sourceId),observedSourceIdentitySha256:xPageSelectedIdentity(original.evidence.observedSourceId)};
    const context={toolId:"codex-browser-visible-dom-v1" as const,sessionId:"synthetic-session",pageUrl:evidence.pageUrl,observedAt:evidence.observedAt};
    const identity={producerId:evidence.producerId,hostId:evidence.hostId,adapterSha256,deploymentManifestSha256:evidence.deploymentManifestSha256,producerAdmissionReceiptSha256:evidence.producerAdmissionReceiptSha256,receiptId:evidence.receiptId};
    const artifact=(folder:string,value:unknown,name?:string)=>{const sha=xCaptureSha256(canonicalJson(value));put(join(artifactRoot,folder,`${name??sha}.json`),value);return sha;};
    const rawToolOutputSha256=artifact("raw-tool-output",{schemaVersion:"x-page-visible-dom-tool-output-v1",...context,toolCallId:id,posts:[original.post]});
    const captureArtifactSha256=artifact("artifacts",{schemaVersion:"x-page-visible-capture-artifact-v1",...identity,...context,resultIndex:0,rawToolOutputSha256,post:original.post});
    const toolReceiptSha256=artifact("tool-receipts",{schemaVersion:"x-page-visible-tool-receipt-v1",...identity,...context,toolCallId:id,resultIndex:0,rawToolOutputSha256,captureArtifactSha256,outcome:"completed"});
    const value=producer.resign({...original,evidence:{...evidence,captureArtifactSha256,toolReceiptSha256}}),captureSha256=artifact("captures",value);
    const payload:XPageArtifactVerifierPayload={schemaVersion:"x-page-artifact-verifier-receipt-v1",verifierId:configData.verifier.verifierId,verifierKeyId:configData.verifier.keyId,...identity,...context,
      verifiedAt:new Date().toISOString(),captureSha256,toolReceiptSha256,captureArtifactSha256,rawToolOutputSha256,sourceId:evidence.sourceId,sourceIdentitySha256:evidence.sourceIdentitySha256,
      observedSourceId:evidence.observedSourceId,observedSourceIdentitySha256:evidence.observedSourceIdentitySha256};
    artifact("verifier-receipts",{payload,signature:sign(null,xPageArtifactVerifierSigningBytes(payload),verifier.privateKey).toString("base64url")},captureSha256);return value;
  };
  return {...fixture,config,pair,loaded,capture,mutate,closeMutation,cleanup:()=>{closeMutation();fixture.cleanup();},live:()=>mutate(db=>db.exec("UPDATE internal_control SET phase='live',global_stop_state='clear'"))};
}
