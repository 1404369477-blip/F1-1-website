import { generateKeyPairSync } from "node:crypto";
import { chmodSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createXPageFileEvidencePort } from "../server/x-page/capture-artifacts.ts";
import { verifyTrustedXCapture, verifyXCaptureArtifacts, xCaptureSha256 } from "../server/x-page/trusted-capture.ts";
import { testXArtifactEnvironment } from "./helpers/x-page-artifacts.ts";
import { TEST_X_NOW, testHash } from "./helpers/x-page-trusted.ts";

const environments: ReturnType<typeof testXArtifactEnvironment>[] = [];
afterEach(() => { for (const env of environments.splice(0)) env.cleanup(); });
function setup() {
  const env = testXArtifactEnvironment(); environments.push(env);
  const port = createXPageFileEvidencePort({ runtimeTrust: env.loaded, now: () => new Date(TEST_X_NOW) });
  return { ...env, port, verify: () => port.verifyCaptureArtifacts({ captureSha256: env.captureSha256, evidence: env.capture.evidence }) };
}
describe("deployment-pinned synthetic X artifact contract", () => {
  it("authenticates the producer, independent verifier, raw result, post and complete artifact graph", () => {
    const env = setup(); const proof = verifyXCaptureArtifacts(verifyTrustedXCapture({ capture: env.capture, trust: env.loaded.trust, now: new Date(TEST_X_NOW) }), env.port);
    expect(proof.captureSha256).toBe(env.captureSha256);
    expect(proof.verifierReceiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(env.port.admissionMetadata!().verifierPublicKeySpkiSha256).toBe(env.config.verifier.publicKey.spkiSha256);
  });
  it.each(["raw-tool-output", "tool-receipts", "artifacts", "captures"])("rejects changed %s bytes", folder => {
    const env = setup(); const hash = folder === "captures" ? env.captureSha256 : folder === "artifacts" ? env.capture.evidence.captureArtifactSha256
      : folder === "tool-receipts" ? env.capture.evidence.toolReceiptSha256 : env.tool.rawToolOutputSha256;
    env.put(join(env.artifactPath, folder, hash + ".json"), "{}"); expect(env.verify).toThrow("HASH_MISMATCH");
  });
  it.each(["config", "producer-key", "verifier-key", "captures", "tool-receipts", "artifacts", "raw-tool-output", "verifier-receipts"])(
    "rejects a BOM that preserves decoded text but changes pinned %s bytes", part => {
      const env = setup();
      const artifactHashes: Record<string, string> = { captures: env.captureSha256, "verifier-receipts": env.captureSha256,
        "tool-receipts": env.capture.evidence.toolReceiptSha256, artifacts: env.capture.evidence.captureArtifactSha256,
        "raw-tool-output": env.tool.rawToolOutputSha256 };
      const path = part === "config" ? env.configPath : part === "producer-key" ? env.config.producerPublicKey.path
        : part === "verifier-key" ? env.config.verifier.publicKey.path : join(env.artifactPath, part, artifactHashes[part] + ".json");
      const original = readFileSync(path), changed = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]);
      expect(new TextDecoder("utf-8", { fatal: true }).decode(changed)).toBe(original.toString("utf8"));
      expect(xCaptureSha256(changed)).not.toBe(xCaptureSha256(original));
      writeFileSync(path, changed);
      expect(part === "config" || part.endsWith("-key") ? env.load : env.verify).toThrow("X_CAPTURE_FILE_ENCODING_CHANGED");
    });
  it("rejects a verifier with a capture-selected signing key", () => {
    const env = setup(); env.signVerifier(env.payload, generateKeyPairSync("ed25519").privateKey);
    expect(env.verify).toThrow("VERIFIER_SIGNATURE_INVALID");
  });
  it.each(["sessionId", "sourceIdentitySha256", "observedSourceIdentitySha256", "captureSha256", "rawToolOutputSha256"] as const)(
    "rejects validly signed but mismatched verifier %s", field => {
      const env = setup(); env.signVerifier({ ...env.payload, [field]: field === "sessionId" ? "other-session" : testHash("other") });
      expect(env.verify).toThrow("BINDING_MISMATCH");
    });
  it("rejects verifier evidence from the future", () => {
    const env = setup(); env.signVerifier({ ...env.payload, verifiedAt: "2026-09-07T00:00:01.000Z" });
    expect(env.verify).toThrow("VERIFIER_TIME_INVALID");
  });
  it("rejects artifact symlinks and replaced storage roots", () => {
    const env = setup(), path = join(env.artifactPath, "captures", env.captureSha256 + ".json");
    const target = join(env.root, "replacement.json"); renameSync(path, target); symlinkSync(target, path);
    expect(env.verify).toThrow(); unlinkSync(path); renameSync(target, path);
    renameSync(env.artifactPath, env.artifactPath + "-old"); symlinkSync(env.artifactPath + "-old", env.artifactPath);
    expect(env.verify).toThrow("ARTIFACT_ROOT_INVALID");
  });
  it.each(["adapter", "public-key", "public-permissions", "circular-config", "config-bytes"])("rejects untrusted deployment %s", part => {
    const env = setup();
    if (part === "adapter") env.put(join(env.releaseRoot, env.config.adapterRelativePath), "// different adapter\n");
    else if (part === "public-key") env.put(env.config.producerPublicKey.path, generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString());
    else if (part === "public-permissions") chmodSync(env.config.verifier.publicKey.path, 0o644);
    else if (part === "circular-config") { Object.assign(env.config.producerTrust, { deploymentManifestSha256: testHash("self") }); env.repinConfig(); }
    else env.put(env.configPath, "{}");
    expect(env.load).toThrow();
  });
  it("re-verifies admitted historical content after renewal without renewing its capture authority", () => {
    const env = setup(); const metadata = env.port.admissionMetadata!();
    const renewed = createXPageFileEvidencePort({ runtimeTrust: { ...env.loaded, trust: { ...env.loaded.trust,
      deploymentManifestSha256: testHash("renewed"), authorizedAt: "2026-09-08T00:00:00.000Z", expiresAt: "2026-09-10T00:00:00.000Z" } },
    now: () => new Date("2026-09-09T00:00:00.000Z") });
    const request = { captureSha256: env.captureSha256, evidence: env.capture.evidence };
    expect(() => renewed.verifyCaptureArtifacts(request)).toThrow("PRODUCER_BINDING_INVALID");
    const historical = renewed.forHistoricalAdmission!({ trust: env.loaded.trust, metadata, acceptedAt: TEST_X_NOW });
    expect(verifyXCaptureArtifacts(verifyTrustedXCapture({ capture: env.capture, trust: env.loaded.trust, now: new Date(TEST_X_NOW) }), historical).captureSha256).toBe(env.captureSha256);
    expect(() => historical.admissionMetadata!()).toThrow("HISTORICAL_ADMISSION_FORBIDDEN");
    expect(() => renewed.forHistoricalAdmission!({ trust: env.loaded.trust, metadata, acceptedAt: "2026-09-09T00:00:00.000Z" })).toThrow("HISTORICAL_TIME_INVALID");
    expect(() => renewed.forHistoricalAdmission!({ trust: env.loaded.trust, metadata: { ...metadata, verifierPublicKeySpkiSha256: testHash("wrong") }, acceptedAt: TEST_X_NOW })).toThrow("HISTORICAL_KEY_INVALID");
  });
});
