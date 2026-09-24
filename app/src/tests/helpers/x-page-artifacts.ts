// Synthetic cryptographic/file fixture only. No real browser, producer admission,
// source activation or production tool output is claimed by these artifacts.
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../../server/db/profile.ts";
import { loadXPageRuntimeTrust } from "../../server/x-page/deployment-trust.ts";
import { xPageArtifactVerifierSigningBytes, type XPageArtifactVerifierPayload } from "../../server/x-page/capture-artifacts.ts";
import { xCaptureSha256 } from "../../server/x-page/trusted-capture.ts";
import { TEST_X_NOW, testHash, testXProducer } from "./x-page-trusted.ts";

export function testXArtifactEnvironment() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "f1-x-artifact-contract-")));
  chmodSync(root, 0o700);
  const put = (path: string, value: unknown) => {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    const text = typeof value === "string" ? value : canonicalJson(value);
    writeFileSync(path, text, { mode: 0o600 }); return xCaptureSha256(text);
  };
  const producer = testXProducer(), verifier = generateKeyPairSync("ed25519");
  const releaseRoot = join(root, "app"), adapterRelativePath = "src/server/x-page/test-adapter.ts";
  const adapterSha256 = put(join(releaseRoot, adapterRelativePath), "// Synthetic fixture adapter, never a real capture.\n");
  const artifactPath = join(root, "evidence"); mkdirSync(artifactPath, { mode: 0o700 });
  const rootStat = lstatSync(artifactPath);
  function keyFile(name: string, key: typeof verifier.publicKey) {
    const path = join(root, name), rawSha256 = put(path, key.export({ format: "pem", type: "spki" }).toString());
    return { path, rawSha256, spkiSha256: xCaptureSha256(key.export({ format: "der", type: "spki" })) };
  }
  const { publicKey: _key, deploymentManifestSha256, ...producerTrust } = producer.trust;
  void _key;
  const config = { schemaVersion: "x-page-runtime-trust-config-v1", producerTrust: { ...producerTrust, adapterSha256 },
    producerPublicKey: keyFile("producer-public.pem", producer.keys.publicKey),
    verifier: { verifierId: "synthetic-verifier", keyId: "synthetic-verifier-key", publicKey: keyFile("verifier-public.pem", verifier.publicKey) },
    adapterRelativePath, toolId: "codex-browser-visible-dom-v1", artifactFormat: "utf8-json-visible-dom-v1",
    artifactRoot: { path: artifactPath, device: rootStat.dev, inode: rootStat.ino } };
  const configPath = join(root, "trust.json"); let configHash = put(configPath, config);
  const load = () => loadXPageRuntimeTrust({ configurationPath: configPath, expectedConfigurationSha256: configHash,
    expectedDeploymentManifestSha256: deploymentManifestSha256, releaseAppRoot: releaseRoot });
  const loaded = load(), original = producer.capture();
  const context = { toolId: "codex-browser-visible-dom-v1" as const, sessionId: "synthetic-session",
    pageUrl: original.evidence.pageUrl, observedAt: original.evidence.observedAt };
  const identity = { producerId: loaded.trust.producerId, hostId: loaded.trust.hostId, adapterSha256,
    deploymentManifestSha256, producerAdmissionReceiptSha256: loaded.trust.producerAdmissionReceiptSha256, receiptId: original.evidence.receiptId };
  const raw = { schemaVersion: "x-page-visible-dom-tool-output-v1", ...context, toolCallId: "synthetic-call", posts: [original.post] };
  const putArtifact = (folder: string, value: unknown, name = testHash("unused")) => {
    const hash = xCaptureSha256(canonicalJson(value)); put(join(artifactPath, folder, (name === testHash("unused") ? hash : name) + ".json"), value); return hash;
  };
  const rawToolOutputSha256 = putArtifact("raw-tool-output", raw);
  const artifact = { schemaVersion: "x-page-visible-capture-artifact-v1", ...identity, ...context, resultIndex: 0, rawToolOutputSha256, post: original.post };
  const captureArtifactSha256 = putArtifact("artifacts", artifact);
  const tool = { schemaVersion: "x-page-visible-tool-receipt-v1", ...identity, ...context, toolCallId: raw.toolCallId,
    resultIndex: 0, rawToolOutputSha256, captureArtifactSha256, outcome: "completed" };
  const toolReceiptSha256 = putArtifact("tool-receipts", tool);
  const capture = producer.resign({ ...original, evidence: { ...original.evidence, adapterSha256, toolReceiptSha256, captureArtifactSha256 } });
  const captureSha256 = putArtifact("captures", capture);
  const payload: XPageArtifactVerifierPayload = { schemaVersion: "x-page-artifact-verifier-receipt-v1",
    verifierId: config.verifier.verifierId, verifierKeyId: config.verifier.keyId, ...identity, ...context,
    verifiedAt: TEST_X_NOW, captureSha256, toolReceiptSha256, captureArtifactSha256, rawToolOutputSha256,
    sourceId: capture.evidence.sourceId, sourceIdentitySha256: capture.evidence.sourceIdentitySha256,
    observedSourceId: capture.evidence.observedSourceId, observedSourceIdentitySha256: capture.evidence.observedSourceIdentitySha256 };
  const signVerifier = (value: XPageArtifactVerifierPayload, key = verifier.privateKey) => {
    const receipt = { payload: value, signature: sign(null, xPageArtifactVerifierSigningBytes(value), key).toString("base64url") };
    putArtifact("verifier-receipts", receipt, captureSha256); return receipt;
  };
  signVerifier(payload);
  return { root, releaseRoot, configPath, config, loaded, producer, verifier, artifactPath, capture, captureSha256,
    raw, tool, artifact, payload, signVerifier, put, putArtifact, load,
    repinConfig: () => { configHash = put(configPath, config); }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
