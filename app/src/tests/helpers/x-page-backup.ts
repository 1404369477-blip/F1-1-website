// Isolated synthetic capture bytes and network responses. A/B/C gateway,
// signature verification, SQLite state and sender are the real implementations.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../server/db/profile.ts";
import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from "../../server/db/database.ts";
import { xPageAdmissionFixture } from "./x-page-admission.ts";
import { testXArtifactEnvironment } from "./x-page-artifacts.ts";
import { testChineseCompletion } from "./x-page-trusted.ts";
import { xPageSelectedIdentity } from "../../server/x-page/admission-migration.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../../server/x-page/admission-schema-identity.ts";
import { createXPageFileEvidencePort, xPageArtifactVerifierSigningBytes, type XPageArtifactVerifierPayload } from "../../server/x-page/capture-artifacts.ts";
import { admitTrustedXPageSource } from "../../server/x-page/source-authority.ts";
import { SqliteXPageImportMutationPort } from "../../server/x-page/import-port.ts";
import { SqliteXPageProducerReceiptLedger } from "../../server/x-page/producer-receipt-ledger.ts";
import { importTrustedXCapture, readReadyXPageSource, type XPageCandidateVersion } from "../../server/x-page/trusted-importer.ts";
import { xCaptureSha256, type TrustedXCapture } from "../../server/x-page/trusted-capture.ts";
import { SqliteInternalOperationGateway, type OwnerProcess } from "../../server/internal-operation/gateway.ts";
import { SqliteGatewayMutationPort } from "../../server/internal-operation/mutation-port.ts";
import { ReviewRealRepository } from "../../server/review-real/repository.ts";
import { createXPageModelGateway } from "../../server/x-page/model-transport.ts";
import { refineOneXCandidate } from "../../server/x-page/refinement.ts";
import type { LoadedXPageRuntimeTrust } from "../../server/x-page/deployment-trust.ts";
import type { XPageAutomaticTarget } from "../../server/x-page/content-authority.ts";
import { ProjectionReceiver } from "../../server/review-real/projection.ts";
import { ProjectionSender } from "../../server/review-real/sender.ts";
import { prepareXPageAutomaticDelivery } from "../../server/x-page/delivery-authority.ts";

const ZERO = "0".repeat(64), hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export async function xPageBackupFixture() {
  const e = await xPageAdmissionFixture(), files = testXArtifactEnvironment();
  files.config.producerTrust.sources = files.config.producerTrust.sources.map(source => ({ ...source, identitySha256: xPageSelectedIdentity(source.sourceId) }));
  files.repinConfig(); const runtimeTrust = files.load(); let sequence = 0, snapshots = 0;
  const captures = (options: Parameters<typeof files.producer.capture>[0] = {}) => {
    const original = files.producer.capture({ ...options, receiptId: options.receiptId ?? `backup-capture-${++sequence}` });
    const context = { toolId: runtimeTrust.toolId, sessionId: "synthetic-backup-session", pageUrl: original.evidence.pageUrl, observedAt: original.evidence.observedAt };
    const producer = { producerId: runtimeTrust.trust.producerId, hostId: runtimeTrust.trust.hostId,
      adapterSha256: runtimeTrust.trust.adapterSha256, deploymentManifestSha256: runtimeTrust.trust.deploymentManifestSha256,
      producerAdmissionReceiptSha256: runtimeTrust.trust.producerAdmissionReceiptSha256, receiptId: original.evidence.receiptId };
    const raw = { schemaVersion: "x-page-visible-dom-tool-output-v1", ...context, toolCallId: `call-${original.evidence.receiptId}`, posts: [original.post] };
    const rawToolOutputSha256 = files.putArtifact("raw-tool-output", raw);
    const artifact = { schemaVersion: "x-page-visible-capture-artifact-v1", ...producer, ...context, resultIndex: 0, rawToolOutputSha256, post: original.post };
    const captureArtifactSha256 = files.putArtifact("artifacts", artifact);
    const tool = { schemaVersion: "x-page-visible-tool-receipt-v1", ...producer, ...context, toolCallId: raw.toolCallId,
      resultIndex: 0, rawToolOutputSha256, captureArtifactSha256, outcome: "completed" };
    const toolReceiptSha256 = files.putArtifact("tool-receipts", tool);
    const capture = files.producer.resign({ ...original, evidence: { ...original.evidence, adapterSha256: producer.adapterSha256,
      sourceIdentitySha256: xPageSelectedIdentity(original.evidence.sourceId), observedSourceIdentitySha256: xPageSelectedIdentity(original.evidence.observedSourceId),
      toolReceiptSha256, captureArtifactSha256 } });
    const captureSha256 = files.putArtifact("captures", capture);
    const payload: XPageArtifactVerifierPayload = { schemaVersion: "x-page-artifact-verifier-receipt-v1", ...producer, ...context,
      verifierId: runtimeTrust.verifier.verifierId, verifierKeyId: runtimeTrust.verifier.keyId, verifiedAt: e.now().toISOString(),
      captureSha256, toolReceiptSha256, captureArtifactSha256, rawToolOutputSha256, sourceId: capture.evidence.sourceId,
      sourceIdentitySha256: capture.evidence.sourceIdentitySha256, observedSourceId: capture.evidence.observedSourceId,
      observedSourceIdentitySha256: capture.evidence.observedSourceIdentitySha256 };
    files.putArtifact("verifier-receipts", { payload, signature: sign(null, xPageArtifactVerifierSigningBytes(payload), files.verifier.privateKey).toString("base64url") }, captureSha256);
    return { capture, captureSha256, rawToolOutputSha256, toolReceiptSha256, captureArtifactSha256 };
  };
  const evidencePort = createXPageFileEvidencePort({ runtimeTrust, now: e.now });
  const admit = (sourceId = "x_f1", value: TrustedXCapture = captures({ author: sourceId.slice(2) as "f1" | "mclarenf1" }).capture) =>
    admitTrustedXPageSource({ database: e.database, gatewayPort: e.port("system_supervisor"), trust: runtimeTrust.trust, evidencePort,
      capture: value, sourceId, expectedRegistryRevision: Number(e.database.prepare("SELECT revision FROM source_registry_v1 WHERE source_id=?").get(sourceId)!.revision),
      operationId: `backup-admit-${++sequence}`, now: e.now });
  const importPort = new SqliteXPageImportMutationPort({ database: e.database, gatewayPort: e.port("x_page_importer"), trust: runtimeTrust.trust, evidencePort, now: e.now });
  const importCapture = (capture: TrustedXCapture, expectedCandidate: XPageCandidateVersion | null = null) => importTrustedXCapture({
    database: e.database, gatewayPort: importPort, receiptLedger: e.receiptLedger, evidencePort, capture, trust: runtimeTrust.trust,
    expectedSourceIdentity: readReadyXPageSource(e.database, runtimeTrust.trust, capture.evidence.sourceId, e.now()), expectedCandidate,
    operationId: `backup-import-${++sequence}`, now: e.now });
  const snapshot = async () => {
    const path = join(e.root, `backup-snapshot-${++snapshots}.sqlite`); await backup(e.database, path); chmodSync(path, 0o600);
    const database = new DatabaseSync(path); try { database.exec("PRAGMA journal_mode=DELETE"); } finally { database.close(); }
    return { path, expectedSha256: xCaptureSha256(readFileSync(path)) };
  };
  const cleanups: Array<() => void> = [];
  const openRestored = (path: string) => {
    const database = openExistingSafeDatabase(path, basename(path), inspectExistingPrivateDatabase(path, basename(path)), [10]);
    const gateway = new SqliteInternalOperationGateway({ database, schemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256, releaseSha256: ZERO, manifestSha256: ZERO, now: e.now });
    const port = (owner: OwnerProcess) => new SqliteGatewayMutationPort({ database, gateway, ownerProcess: owner, now: e.now, handoffProvider: () => {
      const row = database.prepare("SELECT * FROM owner_authorization_handoff WHERE owner_process=? AND consumed_by_operation_id IS NULL AND handoff_id LIKE 'x0017-synthetic-%' ORDER BY handoff_id LIMIT 1").get(owner);
      if (!row) throw new Error("SYNTHETIC_RESTORED_HANDOFF_EXHAUSTED");
      return { handoffId: String(row.handoff_id), ownerProcess: owner, issuer: "f1plus1-owner-supervisor-v1" as const,
        oneTimeNonce: createHash("sha256").update(String(row.handoff_id)).digest("base64url"), releaseSha256: ZERO, manifestSha256: ZERO,
        receiptSha256: hash(String(row.handoff_id)), verifiedAt: String(row.verified_at), expiresAt: String(row.expires_at) };
    } });
    const restored = { database, gateway, port, now: e.now };
    cleanups.push(() => { gateway.close(); database.close(); }); return restored;
  };
  return { ...e, files, runtimeTrust, evidencePort, captures, admit, importCapture, snapshot, openRestored,
    close: () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); files.cleanup(); e.close(); } };
}

type Runtime = Pick<Awaited<ReturnType<typeof xPageBackupFixture>>, "database" | "gateway" | "port" | "now">;
export function backupCandidateRuntime(input: Readonly<{ runtime: Runtime; trust: LoadedXPageRuntimeTrust; target: XPageAutomaticTarget; privateDir: string }>) {
  const e = input.runtime, receiptLedger = new SqliteXPageProducerReceiptLedger(e.database);
  const evidencePort = createXPageFileEvidencePort({ runtimeTrust: input.trust, now: e.now }); let calls = 0;
  const model = createXPageModelGateway({ externalPort: e.port("bilingual_refiner"), privateDir: input.privateDir,
    fetcher: async () => { calls++; return new Response(testChineseCompletion(), { status: 200 }); } });
  const refine = () => refineOneXCandidate({ database: e.database, target: input.target, trust: input.trust.trust, receiptLedger, evidencePort,
    mutationPort: e.port("bilingual_refiner"), ...model, budgetAccountId: "acct-rss", now: e.now });
  return { ...e, target: input.target, receiptLedger, evidencePort, trust: input.trust.trust, refine, supervisorPort: e.port("system_supervisor"),
    reviewer: new ReviewRealRepository(e.database, e.now, e.port("automatic_reviewer")),
    publisher: new ReviewRealRepository(e.database, e.now, e.port("automatic_publisher")), get calls() { return calls; } };
}

export function backupProjectionReceiver(root: string, now: () => Date) {
  const keys = generateKeyPairSync("ed25519"), signingKeyId = "synthetic-backup-projection-key";
  const receiver = new ProjectionReceiver({ root, signingKeyId, publicKey: keys.publicKey, now: () => now().getTime() });
  return { receiver, keys, signingKeyId, root };
}
export function backupProjectionSender(runtime: Runtime, receiver: ReturnType<typeof backupProjectionReceiver>, unknown = false) {
  let posts = 0, gets = 0, signedPacket = "";
  const external = runtime.port("projection_sender"), reconcile = runtime.port("reconciler");
  const sender = new ProjectionSender({ repository: new ReviewRealRepository(runtime.database, runtime.now, external),
    signingKeyId: receiver.signingKeyId, privateKey: receiver.keys.privateKey, actorRef: "synthetic-backup-sender",
    prepareDeliveryAuthority: () => { prepareXPageAutomaticDelivery({ ...runtime, supervisorPort: runtime.port("system_supervisor") }); },
    externalAttempt: external.runExternal.bind(external), externalReconcile: reconcile.runProjectionReconcile.bind(reconcile),
    transport: { post: async value => { posts++; signedPacket = canonicalJson(value); const body = receiver.receiver.receive(value);
      return unknown ? { kind: "unknown" } : { kind: "response", status: 200, body }; },
    getReceipt: async deliveryId => { gets++; return { kind: "response", status: 200, body: receiver.receiver.getReceipt(deliveryId) }; } } });
  return { sender, counts: () => ({ posts, gets }), packet: () => signedPacket };
}
