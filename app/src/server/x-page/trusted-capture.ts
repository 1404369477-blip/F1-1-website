import { createHash, verify, type KeyObject } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { normalizePagePost, X_PAGE_HANDLES, X_PAGE_SELECTION, type PagePost, type XPageCandidate } from "./normalize.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const Time = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const SourceId = z.enum(X_PAGE_HANDLES.map(handle => `x_${handle}`) as [`x_${typeof X_PAGE_HANDLES[number]}`, ...`x_${typeof X_PAGE_HANDLES[number]}`[]]);
const ScopeSchema = z.object({
  sourceId: SourceId,
  identitySha256: Hash,
  authorizationReceiptSha256: Hash,
  sourcePolicySha256: Hash,
}).strict();
const TrustSchema = z.object({
  schemaVersion: z.literal("x-page-deployment-trust-v1"),
  deploymentManifestSha256: Hash,
  producerId: Id,
  keyId: Id,
  hostId: Id,
  adapterSha256: Hash,
  producerAdmissionReceiptSha256: Hash,
  authorizedAt: Time,
  expiresAt: Time,
  maxCaptureAgeMs: z.number().int().min(1).max(86_400_000),
  sources: z.array(ScopeSchema).min(1).max(27),
}).strict();

/** Loaded from a verified deployment. No key, scope or admission is selected by
 * capture input. Registering a real producer remains a separate authority step. */
export type XCaptureDeploymentTrust = Readonly<z.infer<typeof TrustSchema> & { publicKey: KeyObject }>;
export type XCaptureSourceScope = Readonly<z.infer<typeof ScopeSchema>>;
export type CapturedXPost = Readonly<Omit<PagePost, "source"> & { observedOnHandle: string }>;

const EvidenceSchema = z.object({
  schemaVersion: z.literal("x-page-producer-evidence-v1"),
  evidenceClass: z.literal("producer_signed_visible_capture"),
  receiptId: Id,
  deploymentManifestSha256: Hash,
  producerId: Id,
  keyId: Id,
  hostId: Id,
  adapterSha256: Hash,
  producerAdmissionReceiptSha256: Hash,
  selectionSha256: z.literal(X_PAGE_SELECTION.sha256),
  sourceId: SourceId,
  sourceIdentitySha256: Hash,
  observedSourceId: SourceId,
  observedSourceIdentitySha256: Hash,
  pageUrl: z.string().max(2048),
  observedAt: Time,
  toolReceiptSha256: Hash,
  captureArtifactSha256: Hash,
}).strict();
const EnvelopeSchema = z.object({
  schemaVersion: z.literal("x-page-trusted-capture-v1"),
  post: z.record(z.string(), z.unknown()),
  evidence: EvidenceSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();
export type XProducerEvidence = Readonly<z.infer<typeof EvidenceSchema>>;
export type TrustedXCapture = Readonly<{
  schemaVersion: "x-page-trusted-capture-v1";
  post: CapturedXPost;
  evidence: XProducerEvidence;
  signature: string;
}>;
export type VerifiedXCapture = Readonly<{
  capture: TrustedXCapture;
  captureSha256: string;
  normalized: XPageCandidate;
  sourceScope: XCaptureSourceScope;
  observedSourceScope: XCaptureSourceScope;
}>;

export function xCaptureSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Signing bytes are public protocol material. This module never signs, creates
 * producer credentials or interprets a signature as proof that a page was read. */
export function xCaptureSigningBytes(value: Readonly<{ schemaVersion: "x-page-trusted-capture-v1"; post: unknown; evidence: unknown }>): Buffer {
  return Buffer.from(`f1plus1-x-page-producer-signature-v1\n${canonicalJson({ schemaVersion: value.schemaVersion, post: value.post, evidence: value.evidence })}`, "utf8");
}

export function snapshotXCaptureTrust(input: XCaptureDeploymentTrust): XCaptureDeploymentTrust {
  const { publicKey, ...rest } = input;
  const parsed = TrustSchema.safeParse(rest);
  assert(parsed.success, "X_CAPTURE_DEPLOYMENT_TRUST_INVALID");
  assert(publicKey?.type === "public" && publicKey.asymmetricKeyType === "ed25519", "X_CAPTURE_TRUST_KEY_INVALID");
  assert(new Set(parsed.data.sources.map(source => source.sourceId)).size === parsed.data.sources.length, "X_CAPTURE_TRUST_SCOPE_DUPLICATE");
  assert(Date.parse(parsed.data.expiresAt) > Date.parse(parsed.data.authorizedAt), "X_CAPTURE_TRUST_TIME_INVALID");
  return Object.freeze({ ...deepFreeze(parsed.data), publicKey });
}

/** Authenticates the producer and signed content against an explicit deployment.
 * A separate evidence port must match real capture/tool artifacts before import.
 * This function alone grants no source, database, model or publication authority. */
export function verifyTrustedXCapture(input: Readonly<{ capture: unknown; trust: XCaptureDeploymentTrust; now: Date }>): VerifiedXCapture {
  const trust = snapshotXCaptureTrust(input.trust);
  const parsed = EnvelopeSchema.safeParse(input.capture);
  assert(parsed.success, "X_CAPTURE_ENVELOPE_INVALID");
  const capture = parsed.data;
  assert(Buffer.byteLength(canonicalJson(capture), "utf8") <= 256 * 1024, "X_CAPTURE_TOO_LARGE");
  const evidence = capture.evidence;
  for (const field of ["deploymentManifestSha256", "producerId", "keyId", "hostId", "adapterSha256", "producerAdmissionReceiptSha256"] as const) {
    assert(evidence[field] === trust[field], "X_CAPTURE_PRODUCER_BINDING_INVALID");
  }
  const now = input.now.getTime();
  const observedAt = Date.parse(evidence.observedAt);
  assert(Number.isFinite(now) && now >= Date.parse(trust.authorizedAt) && now < Date.parse(trust.expiresAt), "X_CAPTURE_TRUST_EXPIRED");
  assert(observedAt >= Date.parse(trust.authorizedAt) && observedAt < Date.parse(trust.expiresAt), "X_CAPTURE_OUTSIDE_AUTHORIZATION");
  assert(observedAt <= now, "X_CAPTURE_TIME_IN_FUTURE");
  assert(now - observedAt <= trust.maxCaptureAgeMs, "X_CAPTURE_TOO_OLD");
  const sourceScope = trust.sources.find(source => source.sourceId === evidence.sourceId);
  const observedScope = trust.sources.find(source => source.sourceId === evidence.observedSourceId);
  assert(sourceScope?.identitySha256 === evidence.sourceIdentitySha256
    && observedScope?.identitySha256 === evidence.observedSourceIdentitySha256, "X_CAPTURE_SOURCE_SCOPE_INVALID");
  const signature = Buffer.from(capture.signature, "base64url");
  assert(signature.length === 64 && signature.toString("base64url") === capture.signature
    && verify(null, xCaptureSigningBytes(capture), trust.publicKey, signature), "X_CAPTURE_SIGNATURE_INVALID");
  // Readiness flags are absent from this wire contract. The normalizer's legacy
  // flags are supplied only after signature/scope authentication; import must
  // separately verify current registry and evidence authority below this layer.
  const { observedOnHandle, ...post } = capture.post;
  assert(typeof observedOnHandle === "string" && !Object.hasOwn(post, "source"), "X_CAPTURE_POST_INVALID");
  const normalized = normalizePagePost({ ...post, source: { handle: observedOnHandle, enabled: true, identityStatus: "verified" } });
  assert(evidence.sourceId === `x_${normalized.authorHandle}`
    && evidence.observedSourceId === `x_${normalized.observedOnHandle}`
    && evidence.pageUrl === post.pageUrl && evidence.observedAt === normalized.observedAt, "X_CAPTURE_POST_BINDING_INVALID");
  return deepFreeze({ capture: structuredClone(capture) as unknown as TrustedXCapture,
    captureSha256: xCaptureSha256(canonicalJson(capture)), normalized, sourceScope, observedSourceScope: observedScope });
}

const CaptureProofSchema = z.object({
  schemaVersion: z.literal("x-page-capture-proof-v1"),
  captureSha256: Hash,
  producerId: Id,
  hostId: Id,
  adapterSha256: Hash,
  pageUrl: z.string().max(2048),
  observedAt: Time,
  toolReceiptSha256: Hash,
  captureArtifactSha256: Hash,
  verifierReceiptSha256: Hash,
}).strict();
export type XCaptureProof = Readonly<z.infer<typeof CaptureProofSchema>>;
export type XCaptureHistoricalEvidenceMetadata = Readonly<{
  schemaVersion: "x-page-historical-evidence-v1";
  configurationSha256: string;
  verifierId: string;
  verifierKeyId: string;
  verifierPublicKeySpkiPem: string;
  verifierPublicKeySpkiSha256: string;
  toolId: string;
}>;
/** Production adapter must retrieve and verify actual tool/capture artifacts and
 * its durable verifier receipt. A caller's true/verified flag is not this port.
 * Synthetic test adapters are not admissible deployment producers. */
export type XCaptureEvidencePort = Readonly<{
  verifyCaptureArtifacts(input: Readonly<{ captureSha256: string; evidence: XProducerEvidence }>): unknown;
  /** Production admission persists these public verifier pins in its immutable
   * authority core. Test ports without metadata cannot admit a real producer. */
  admissionMetadata?(): XCaptureHistoricalEvidenceMetadata;
  /** Only a verified immutable admission ledger may supply these historical
   * pins. It grants historical evidence verification, never current source access. */
  forHistoricalAdmission?(input: Readonly<{ trust: XCaptureDeploymentTrust; acceptedAt: string;
    metadata: XCaptureHistoricalEvidenceMetadata }>): XCaptureEvidencePort;
}>;

export function verifyXCaptureArtifacts(capture: VerifiedXCapture, port: XCaptureEvidencePort): XCaptureProof {
  assert(typeof port?.verifyCaptureArtifacts === "function", "X_CAPTURE_EVIDENCE_PORT_REQUIRED");
  const proof = CaptureProofSchema.safeParse(port.verifyCaptureArtifacts({ captureSha256: capture.captureSha256, evidence: capture.capture.evidence }));
  assert(proof.success, "X_CAPTURE_ARTIFACT_PROOF_INVALID");
  assert(proof.data.captureSha256 === capture.captureSha256, "X_CAPTURE_ARTIFACT_PROOF_MISMATCH");
  for (const field of ["producerId", "hostId", "adapterSha256", "pageUrl", "observedAt", "toolReceiptSha256", "captureArtifactSha256"] as const) {
    assert(proof.data[field] === capture.capture.evidence[field], "X_CAPTURE_ARTIFACT_PROOF_MISMATCH");
  }
  return deepFreeze(proof.data);
}
