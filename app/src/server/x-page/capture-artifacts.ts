import { createPublicKey, verify } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { readXCapturePrivateFile } from "./private-artifact-file.ts";
import { assertXCaptureArtifactRoot, type LoadedXPageRuntimeTrust } from "./deployment-trust.ts";
import { snapshotXCaptureTrust, verifyTrustedXCapture, xCaptureSha256, type XCaptureEvidencePort, type XProducerEvidence,
  type XCaptureHistoricalEvidenceMetadata } from "./trusted-capture.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const Time = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const ToolId = z.enum(["codex-browser-visible-dom-v1", "codex-chrome-visible-dom-v1"]);
const HistoricalMetadataSchema = z.object({ schemaVersion: z.literal("x-page-historical-evidence-v1"),
  configurationSha256: Hash, verifierId: Id, verifierKeyId: Id, verifierPublicKeySpkiPem: z.string().max(4096),
  verifierPublicKeySpkiSha256: Hash, toolId: ToolId }).strict();
const Context = { toolId: ToolId, sessionId: Id, pageUrl: z.string().max(2048), observedAt: Time };
const Producer = { producerId: Id, hostId: Id, adapterSha256: Hash, deploymentManifestSha256: Hash,
  producerAdmissionReceiptSha256: Hash, receiptId: Id };
const ToolReceiptSchema = z.object({ schemaVersion: z.literal("x-page-visible-tool-receipt-v1"),
  ...Producer, ...Context, toolCallId: Id, resultIndex: z.number().int().min(0).max(99),
  rawToolOutputSha256: Hash, captureArtifactSha256: Hash, outcome: z.literal("completed") }).strict();
// Application adapter wire format, not a claim about a native MCP response
// schema. Real producer/verifier code must be validated against actual M1 DOM.
const ToolOutputSchema = z.object({ schemaVersion: z.literal("x-page-visible-dom-tool-output-v1"),
  ...Context, toolCallId: Id, posts: z.array(z.record(z.string(), z.unknown())).min(1).max(100) }).strict();
const ArtifactSchema = z.object({ schemaVersion: z.literal("x-page-visible-capture-artifact-v1"),
  ...Producer, ...Context, resultIndex: z.number().int().min(0).max(99),
  rawToolOutputSha256: Hash, post: z.record(z.string(), z.unknown()) }).strict();
const VerifierPayloadSchema = z.object({ schemaVersion: z.literal("x-page-artifact-verifier-receipt-v1"),
  verifierId: Id, verifierKeyId: Id, ...Producer, ...Context, verifiedAt: Time,
  captureSha256: Hash, toolReceiptSha256: Hash, captureArtifactSha256: Hash, rawToolOutputSha256: Hash,
  sourceId: Id, sourceIdentitySha256: Hash, observedSourceId: Id, observedSourceIdentitySha256: Hash,
}).strict();
const VerifierReceiptSchema = z.object({ payload: VerifierPayloadSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export type XPageArtifactVerifierPayload = Readonly<z.infer<typeof VerifierPayloadSchema>>;
export type XPageVisibleToolReceipt = Readonly<z.infer<typeof ToolReceiptSchema>>;
export type XPageVisibleToolOutput = Readonly<z.infer<typeof ToolOutputSchema>>;
export type XPageVisibleCaptureArtifact = Readonly<z.infer<typeof ArtifactSchema>>;

function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
export function xPageArtifactVerifierSigningBytes(payload: XPageArtifactVerifierPayload): Buffer {
  const value = VerifierPayloadSchema.parse(payload);
  return Buffer.from(`f1plus1-x-page-artifact-verifier-v1\n${canonicalJson(value)}`, "utf8");
}
function readJson(root: LoadedXPageRuntimeTrust["artifactRoot"], folder: string, name: string, maxBytes: number,
  expectedSha256?: string): Readonly<{ value: unknown; sha256: string }> {
  assert(Hash.safeParse(name).success, "X_CAPTURE_ARTIFACT_NAME_INVALID");
  const file = readXCapturePrivateFile(join(root.path, folder, name + ".json"), maxBytes);
  assert(file, "X_CAPTURE_ARTIFACT_MISSING");
  const sha256 = xCaptureSha256(file.text);
  assert(expectedSha256 === undefined || sha256 === expectedSha256, "X_CAPTURE_ARTIFACT_HASH_MISMATCH");
  let value: unknown;
  try { value = JSON.parse(file.text); } catch { throw new Error("X_CAPTURE_ARTIFACT_JSON_INVALID"); }
  return Object.freeze({ value, sha256 });
}
function same(actual: Record<string, unknown>, expected: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) assert(actual[field] === expected[field], "X_CAPTURE_ARTIFACT_BINDING_MISMATCH");
}

/** Reads a fixed private UTF-8 JSON artifact tree and a verifier signature whose
 * key is pinned by deployment. No callback-selected trust root, image decoding,
 * network request or receipt creation occurs here. Missing generator/DOM evidence
 * remains an admission failure; synthetic artifacts never prove a real capture.
 */
export function createXPageFileEvidencePort(input: Readonly<{
  runtimeTrust: LoadedXPageRuntimeTrust;
  now: () => Date;
}>): XCaptureEvidencePort {
  return fileEvidencePort(input, false);
}
function fileEvidencePort(input: Readonly<{ runtimeTrust: LoadedXPageRuntimeTrust; now: () => Date }>, historical: boolean): XCaptureEvidencePort {
  const loaded = input.runtimeTrust;
  assert(loaded.artifactFormat === "utf8-json-visible-dom-v1", "X_CAPTURE_ARTIFACT_FORMAT_UNSUPPORTED");
  return Object.freeze({
    admissionMetadata(): XCaptureHistoricalEvidenceMetadata {
      assert(!historical, "X_CAPTURE_HISTORICAL_ADMISSION_FORBIDDEN");
      return Object.freeze({ schemaVersion: "x-page-historical-evidence-v1", configurationSha256: loaded.configurationSha256,
        verifierId: loaded.verifier.verifierId, verifierKeyId: loaded.verifier.keyId,
        verifierPublicKeySpkiPem: loaded.verifier.publicKey.export({ format: "pem", type: "spki" }).toString(),
        verifierPublicKeySpkiSha256: xCaptureSha256(loaded.verifier.publicKey.export({ format: "der", type: "spki" })),
        toolId: loaded.toolId });
    },
    forHistoricalAdmission(request) {
      assert(!historical && Time.safeParse(request.acceptedAt).success && Date.parse(request.acceptedAt) <= input.now().getTime(),
        "X_CAPTURE_HISTORICAL_CONTEXT_INVALID");
      const parsed = HistoricalMetadataSchema.safeParse(request.metadata);
      assert(parsed.success && /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(parsed.data.verifierPublicKeySpkiPem),
        "X_CAPTURE_HISTORICAL_METADATA_INVALID");
      const metadata = parsed.data, key = createPublicKey(metadata.verifierPublicKeySpkiPem);
      assert(key.type === "public" && key.asymmetricKeyType === "ed25519"
        && xCaptureSha256(key.export({ format: "der", type: "spki" })) === metadata.verifierPublicKeySpkiSha256,
        "X_CAPTURE_HISTORICAL_KEY_INVALID");
      const trust = snapshotXCaptureTrust(request.trust);
      assert(Date.parse(request.acceptedAt) >= Date.parse(trust.authorizedAt)
        && Date.parse(request.acceptedAt) < Date.parse(trust.expiresAt), "X_CAPTURE_HISTORICAL_TIME_INVALID");
      // The current deployment supplies the storage root. The immutable ledger
      // supplies old verifier/trust metadata; no old file path is adopted here.
      const runtimeTrust: LoadedXPageRuntimeTrust = Object.freeze({ ...loaded, trust,
        verifier: Object.freeze({ verifierId: metadata.verifierId, keyId: metadata.verifierKeyId, publicKey: key }),
        configurationSha256: metadata.configurationSha256, toolId: metadata.toolId });
      return fileEvidencePort({ runtimeTrust, now: () => new Date(request.acceptedAt) }, true);
    },
    verifyCaptureArtifacts(request: Readonly<{ captureSha256: string; evidence: XProducerEvidence }>) {
      assertXCaptureArtifactRoot(loaded.artifactRoot);
      const now = input.now();
      const captureFile = readJson(loaded.artifactRoot, "captures", request.captureSha256, 256 * 1024, request.captureSha256);
      const captured = verifyTrustedXCapture({ capture: captureFile.value, trust: loaded.trust, now });
      assert(captured.captureSha256 === request.captureSha256
        && canonicalJson(captured.capture.evidence) === canonicalJson(request.evidence), "X_CAPTURE_ARTIFACT_CAPTURE_MISMATCH");
      const evidence = captured.capture.evidence;
      const toolFile = readJson(loaded.artifactRoot, "tool-receipts", evidence.toolReceiptSha256, 64 * 1024, evidence.toolReceiptSha256);
      const artifactFile = readJson(loaded.artifactRoot, "artifacts", evidence.captureArtifactSha256, 256 * 1024, evidence.captureArtifactSha256);
      const verifierFile = readJson(loaded.artifactRoot, "verifier-receipts", request.captureSha256, 64 * 1024);
      const toolResult = ToolReceiptSchema.safeParse(toolFile.value), artifactResult = ArtifactSchema.safeParse(artifactFile.value),
        verifierResult = VerifierReceiptSchema.safeParse(verifierFile.value);
      assert(toolResult.success && artifactResult.success && verifierResult.success, "X_CAPTURE_ARTIFACT_SCHEMA_INVALID");
      const tool = toolResult.data, artifact = artifactResult.data, verifier = verifierResult.data;
      const payload = verifier.payload;
      assert(payload.verifierId === loaded.verifier.verifierId && payload.verifierKeyId === loaded.verifier.keyId,
        "X_CAPTURE_VERIFIER_IDENTITY_INVALID");
      const signature = Buffer.from(verifier.signature, "base64url");
      assert(signature.length === 64 && signature.toString("base64url") === verifier.signature
        && verify(null, xPageArtifactVerifierSigningBytes(payload), loaded.verifier.publicKey, signature), "X_CAPTURE_VERIFIER_SIGNATURE_INVALID");
      const producerFields = ["producerId", "hostId", "adapterSha256", "deploymentManifestSha256", "producerAdmissionReceiptSha256",
        "receiptId", "pageUrl", "observedAt"];
      same(tool, evidence, producerFields); same(artifact, evidence, producerFields); same(payload, evidence, producerFields);
      same(payload, evidence, ["sourceId", "sourceIdentitySha256", "observedSourceId", "observedSourceIdentitySha256",
        "toolReceiptSha256", "captureArtifactSha256"]);
      assert(payload.captureSha256 === request.captureSha256 && tool.captureArtifactSha256 === evidence.captureArtifactSha256
        && tool.rawToolOutputSha256 === artifact.rawToolOutputSha256 && payload.rawToolOutputSha256 === artifact.rawToolOutputSha256
        && tool.resultIndex === artifact.resultIndex && tool.toolId === loaded.toolId
        && artifact.toolId === loaded.toolId && payload.toolId === loaded.toolId, "X_CAPTURE_ARTIFACT_BINDING_MISMATCH");
      same(artifact, tool, ["sessionId"]); same(payload, tool, ["sessionId"]);
      const verifiedAt = Date.parse(payload.verifiedAt);
      assert(Number.isFinite(now.getTime()) && verifiedAt >= Date.parse(evidence.observedAt) && verifiedAt <= now.getTime()
        && verifiedAt < Date.parse(loaded.trust.expiresAt), "X_CAPTURE_VERIFIER_TIME_INVALID");
      const rawFile = readJson(loaded.artifactRoot, "raw-tool-output", tool.rawToolOutputSha256, 4 * 1024 * 1024, tool.rawToolOutputSha256);
      const rawResult = ToolOutputSchema.safeParse(rawFile.value); assert(rawResult.success, "X_CAPTURE_TOOL_OUTPUT_INVALID");
      const raw = rawResult.data;
      same(raw, tool, ["toolId", "toolCallId", "sessionId", "pageUrl", "observedAt"]);
      assert(tool.resultIndex < raw.posts.length && canonicalJson(raw.posts[tool.resultIndex]) === canonicalJson(artifact.post)
        && canonicalJson(artifact.post) === canonicalJson(captured.capture.post), "X_CAPTURE_ARTIFACT_POST_MISMATCH");
      assertXCaptureArtifactRoot(loaded.artifactRoot);
      return Object.freeze({ schemaVersion: "x-page-capture-proof-v1", captureSha256: captured.captureSha256,
        producerId: evidence.producerId, hostId: evidence.hostId, adapterSha256: evidence.adapterSha256,
        pageUrl: evidence.pageUrl, observedAt: evidence.observedAt, toolReceiptSha256: evidence.toolReceiptSha256,
        captureArtifactSha256: evidence.captureArtifactSha256, verifierReceiptSha256: verifierFile.sha256 });
    },
  });
}
