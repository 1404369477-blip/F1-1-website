import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJsonV1, type BilingualPublicationAuthorization as GatewayPublicationAuthorization, type BilingualPublicationReceipt as GatewayPublicationReceipt, type BilingualWithdrawalAuthorization } from "../internal-operation/gateway.ts";
import type { BilingualPublicationAuthorityPort, GatewayMutationPort } from "../internal-operation/mutation-port.ts";

function hash(domain: string, value: unknown): string {
  return createHash("sha256").update(`${domain}\n${canonicalJsonV1(value)}`).digest("hex");
}

export function bilingualPublicationId(publicId: string, revision: number): string {
  return `publication-${hash("f1plus1-bilingual-publication-id-v1", { publicId, revision }).slice(0, 48)}`;
}

export type BilingualProjectionArtifact = Readonly<{
  payloadJson: string;
  payloadHash: string;
  signature: string;
  releaseSha256: string;
  manifestSha256: string;
  generationId: string;
  generation: number;
}>;
export type BilingualPublicationAuthorization = GatewayPublicationAuthorization & Readonly<{
  idempotencyKey: string;
  freshDigest?: string;
  freshVerifiedAt?: string;
  resourceHash?: string;
}>;
export type BilingualPublicationReceipt = Omit<GatewayPublicationReceipt, "outboxDeliveryId" | "status"> & Readonly<{
  outboxDeliveryId: string;
  status: "published" | "withdrawn";
}>;

function projectionId(publicationId: string, generation: number): string {
  return `projection-${hash("f1plus1-bilingual-projection-id-v1", { publicationId, generation }).slice(0, 48)}`;
}

export class AdminBilingualProjectionWriter {
  private readonly publicationPort: BilingualPublicationAuthorityPort;

  public constructor(private readonly database: DatabaseSync, mutationPort: GatewayMutationPort, private readonly now: () => Date = () => new Date()) {
    const candidate = mutationPort as Partial<BilingualPublicationAuthorityPort>;
    if (!candidate.commitBilingualInitialPublication || !candidate.activateBilingualProjection || !candidate.commitBilingualWithdrawal) {
      throw new Error("BILINGUAL_PROJECTION_GATEWAY_REQUIRED");
    }
    this.publicationPort = candidate as BilingualPublicationAuthorityPort;
    void this.now;
  }

  public publish(authorization: BilingualPublicationAuthorization, input: Readonly<{ candidateId: string; expectedBundleRevision: number; artifact: BilingualProjectionArtifact; activationOperationId: string }>): BilingualPublicationReceipt {
    const bundle = this.database.prepare("SELECT public_id FROM bilingual_bundle_v1 WHERE candidate_id=? AND revision=? AND state='reviewable'").get(input.candidateId, input.expectedBundleRevision) as Record<string, unknown> | undefined;
    if (!bundle) throw new Error("BILINGUAL_PUBLICATION_BUNDLE_STALE");
    const publicationId = bilingualPublicationId(String(bundle.public_id), 1);
    const artifact = Object.freeze({ ...input.artifact, projectionId: projectionId(publicationId, input.artifact.generation), schemaVersion: "public-read-bilingual-v2" as const });
    const gatewayAuthorization: GatewayPublicationAuthorization = Object.freeze({
      actorRef: authorization.actorRef,
      sessionDigest: authorization.sessionDigest,
      csrfDigest: authorization.csrfDigest,
      operationId: authorization.operationId,
      bodyHash: authorization.bodyHash,
    });
    const publicationInput = Object.freeze({ candidateId: input.candidateId, expectedBundleRevision: input.expectedBundleRevision, publicationId, publicId: String(bundle.public_id), artifact });
    const staged = this.publicationPort.commitBilingualInitialPublication(gatewayAuthorization, publicationInput);
    const active = this.publicationPort.activateBilingualProjection(Object.freeze({ ...gatewayAuthorization, operationId: input.activationOperationId }), Object.freeze({ ...publicationInput, publicationOperationId: authorization.operationId }));
    if (staged.publicationId !== active.publicationId || active.outboxDeliveryId === null || active.status !== "published") throw new Error("BILINGUAL_PUBLICATION_ACTIVATION_INVALID");
    return Object.freeze({ ...active, outboxDeliveryId: active.outboxDeliveryId, status: "published" });
  }

  public withdraw(authorization: BilingualPublicationAuthorization, input: Readonly<{ publicationId: string; expectedRevision: number; artifact: BilingualProjectionArtifact }>): BilingualPublicationReceipt {
    if (!authorization.freshDigest || !authorization.freshVerifiedAt || !authorization.resourceHash) throw new Error("BILINGUAL_WITHDRAWAL_FRESH_AUTHORITY_REQUIRED");
    const previous = this.database.prepare("SELECT public_id FROM bilingual_publication_v1 WHERE publication_id=? AND revision=? AND status='published'").get(input.publicationId, input.expectedRevision) as Record<string, unknown> | undefined;
    if (!previous) throw new Error("BILINGUAL_WITHDRAW_PUBLICATION_STALE");
    const withdrawalPublicationId = bilingualPublicationId(String(previous.public_id), input.expectedRevision + 1);
    const artifact = Object.freeze({ ...input.artifact, projectionId: projectionId(withdrawalPublicationId, input.artifact.generation), schemaVersion: "public-read-bilingual-v2" as const });
    const gatewayAuthorization: BilingualWithdrawalAuthorization = Object.freeze({
      actorRef: authorization.actorRef,
      sessionDigest: authorization.sessionDigest,
      csrfDigest: authorization.csrfDigest,
      operationId: authorization.operationId,
      bodyHash: authorization.bodyHash,
      freshDigest: authorization.freshDigest,
      verifiedAt: authorization.freshVerifiedAt,
      resourceHash: authorization.resourceHash,
    });
    const receipt = this.publicationPort.commitBilingualWithdrawal(gatewayAuthorization, Object.freeze({
      publicationId: input.publicationId,
      expectedRevision: input.expectedRevision,
      withdrawalPublicationId,
      publicId: String(previous.public_id),
      artifact,
    }));
    if (receipt.outboxDeliveryId === null || receipt.status !== "withdrawn") throw new Error("BILINGUAL_WITHDRAWAL_COMMIT_INVALID");
    return Object.freeze({ ...receipt, outboxDeliveryId: receipt.outboxDeliveryId, status: "withdrawn" });
  }
}
