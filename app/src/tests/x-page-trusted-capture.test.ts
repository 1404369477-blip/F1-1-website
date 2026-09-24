import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";

import { verifyTrustedXCapture, verifyXCaptureArtifacts, type TrustedXCapture } from "../server/x-page/trusted-capture.ts";
import { TEST_X_NOW, testHash, testXProducer } from "./helpers/x-page-trusted.ts";

describe("X signed capture contract (synthetic keys; no real capture assertion)", () => {
  test("authenticates exact producer scope and preserves a complete Unicode body", () => {
    const p = testXProducer();
    const text = `${"完整正文🏎️".repeat(800)}唯一尾部`;
    const result = verifyTrustedXCapture({ capture: p.capture({ text }), trust: p.trust, now: new Date(TEST_X_NOW) });
    expect(result.normalized.text).toBe(text);
    expect(result.normalized.authorHandle).toBe("f1");
    expect(result.sourceScope.sourceId).toBe("x_f1");
    expect(Object.isFrozen(result.capture.post)).toBe(true);
    expect(result).not.toHaveProperty("productionVerified");
  });

  test("a valid signature does not fulfill the separate capture-artifact requirement", () => {
    const p = testXProducer();
    const result = verifyTrustedXCapture({ capture: p.capture(), trust: p.trust, now: new Date(TEST_X_NOW) });
    expect(() => verifyXCaptureArtifacts(result, { verifyCaptureArtifacts: () => true })).toThrow("X_CAPTURE_ARTIFACT_PROOF_INVALID");
    expect(() => verifyXCaptureArtifacts(result, { verifyCaptureArtifacts: input => ({
      ...p.evidencePort.verifyCaptureArtifacts(input) as object, captureArtifactSha256: testHash("unrelated-artifact"),
    }) })).toThrow("X_CAPTURE_ARTIFACT_PROOF_MISMATCH");
    expect(verifyXCaptureArtifacts(result, p.evidencePort).toolReceiptSha256).toBe(result.capture.evidence.toolReceiptSha256);
  });

  test.each(["producerId", "keyId", "hostId", "adapterSha256", "deploymentManifestSha256", "producerAdmissionReceiptSha256"] as const)(
    "rejects a correctly signed envelope with an unconfigured %s", field => {
      const p = testXProducer(), original = p.capture();
      const value = field.endsWith("Sha256") ? testHash("other") : "other-identity";
      const capture = p.resign({ ...original, evidence: { ...original.evidence, [field]: value } });
      expect(() => verifyTrustedXCapture({ capture, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_CAPTURE_PRODUCER_BINDING_INVALID");
    });

  test("rejects signature-key substitution and body edits after signing", () => {
    const p = testXProducer(), capture = p.capture();
    expect(() => verifyTrustedXCapture({ capture, trust: { ...p.trust, publicKey: generateKeyPairSync("ed25519").publicKey }, now: new Date(TEST_X_NOW) }))
      .toThrow("X_CAPTURE_SIGNATURE_INVALID");
    expect(() => verifyTrustedXCapture({ capture: { ...capture, post: { ...capture.post, text: "modified" } }, trust: p.trust, now: new Date(TEST_X_NOW) }))
      .toThrow("X_CAPTURE_SIGNATURE_INVALID");
  });

  test("rejects a signed synthetic declaration and wire readiness flags", () => {
    const p = testXProducer(), capture = p.capture();
    const synthetic = p.resign({ ...capture, evidence: { ...capture.evidence, evidenceClass: "synthetic_clone" } } as unknown as TrustedXCapture);
    expect(() => verifyTrustedXCapture({ capture: synthetic, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_CAPTURE_ENVELOPE_INVALID");
    const flags = p.resign({ ...capture, post: { ...capture.post, source: { handle: "f1", enabled: true, identityStatus: "verified" } } } as unknown as TrustedXCapture);
    expect(() => verifyTrustedXCapture({ capture: flags, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_CAPTURE_POST_INVALID");
  });

  test("binds both observed and authored sources for a repost", () => {
    const p = testXProducer(), capture = p.capture({ author: "f1", observedOn: "mclarenf1" });
    const result = verifyTrustedXCapture({ capture, trust: p.trust, now: new Date(TEST_X_NOW) });
    expect(result.sourceScope.sourceId).toBe("x_f1");
    expect(result.observedSourceScope.sourceId).toBe("x_mclarenf1");
    expect(() => verifyTrustedXCapture({ capture, trust: { ...p.trust, sources: p.trust.sources.filter(source => source.sourceId === "x_f1") }, now: new Date(TEST_X_NOW) }))
      .toThrow("X_CAPTURE_SOURCE_SCOPE_INVALID");
    const wrong = p.resign({ ...capture, evidence: { ...capture.evidence, sourceId: "x_mclarenf1", sourceIdentitySha256: testHash("mclarenf1") } });
    expect(() => verifyTrustedXCapture({ capture: wrong, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_CAPTURE_POST_BINDING_INVALID");
  });

  test.each([
    ["2026-09-06T23:58:00.000Z", "X_CAPTURE_TIME_IN_FUTURE"],
    ["2026-09-07T01:00:00.001Z", "X_CAPTURE_TOO_OLD"],
    ["2026-09-08T00:00:00.000Z", "X_CAPTURE_TRUST_EXPIRED"],
  ])("enforces capture and admission time at %s", (now, reason) => {
    const p = testXProducer();
    expect(() => verifyTrustedXCapture({ capture: p.capture(), trust: p.trust, now: new Date(now) })).toThrow(reason);
  });

  test("rejects incomplete text even when the producer signed it", () => {
    const p = testXProducer(), original = p.capture();
    const capture = p.resign({ ...original, post: { ...original.post, textComplete: false } });
    expect(() => verifyTrustedXCapture({ capture, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_PAGE_TEXT_INCOMPLETE");
  });

  test("rejects duplicate deployment scopes and mismatched observed-page evidence", () => {
    const p = testXProducer(), capture = p.capture();
    expect(() => verifyTrustedXCapture({ capture, trust: { ...p.trust, sources: [p.trust.sources[0], p.trust.sources[0]] }, now: new Date(TEST_X_NOW) }))
      .toThrow("X_CAPTURE_TRUST_SCOPE_DUPLICATE");
    const wrong = p.resign({ ...capture, evidence: { ...capture.evidence, pageUrl: "https://x.com/mclarenf1" } });
    expect(() => verifyTrustedXCapture({ capture: wrong, trust: p.trust, now: new Date(TEST_X_NOW) })).toThrow("X_CAPTURE_POST_BINDING_INVALID");
  });
});
