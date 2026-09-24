import { readXPageCommittedDelivery } from "../x-page/delivery-authority.ts";
import { xPageAutomaticContentBindings } from "../x-page/content-authority.ts";
import { xPageRefinementReadBindings } from "../x-page/source-authority.ts";
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  canonicalJsonV1,
  type CapabilityClass,
  canonicalExternalRequestHash,
  type EntityBinding,
  type EntityKind,
  type EgressClass,
  type FenceBinding,
  type GatewayOperationRequest,
  type MutationKind,
  type OperationKind,
  type OwnerProcess,
  type Phase,
  type SqliteInternalOperationGateway,
  type GatewayWriteInput,
  type ClosedExternalRequest,
  type ClosedExternalResponse,
  type CommittedAttemptHandle,
  type StartedAttemptHandle,
  type ReconcileRequiredHandle,
  type XManualGatewayMutation,
  type QuickLaunchAuthorityTransition,
  type QuickLaunchAuthorityCapability,
  type SourceRegistryGatewayMutation,
  type BilingualSafetyAuthorization,
  type BilingualSafetyDecisionInput,
  type BilingualSafetyDecisionReceipt,
  type BilingualApprovalAuthorization,
  type BilingualApprovalInput,
  type BilingualApprovalReceipt,
  type BilingualPublicationAuthorization,
  type BilingualWithdrawalAuthorization,
  type BilingualInitialPublicationInput,
  type BilingualProjectionActivationInput,
  type BilingualWithdrawalInput,
  type BilingualPublicationReceipt,
} from "./gateway.ts";
import type { OperationCapability, OwnerSupervisorHandoff } from "./gateway.ts";
import { assertPhaseAllowsExternal, readPhaseSnapshot } from "./phase.ts";

const ZERO = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomNonce(): string {
  return randomBytes(32).toString("base64url");
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function id(value: unknown, code: string): string {
  assert(
    typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value),
    code,
  );
  return value;
}

function phase(value: unknown): Phase {
  assert(
    value === "disabled" ||
      value === "backlog" ||
      value === "live" ||
      value === "paused",
    "PHASE_INVALID",
  );
  return value;
}

export type GatewayMutationPortInput = Readonly<{
  operationId: string;
  operationKind: OperationKind;
  ownerProcess?: OwnerProcess;
  entityKind: EntityKind;
  entityId: string;
  mutationKind: MutationKind;
  statement: string;
  parameters?: readonly unknown[];
  identity: Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }>;
  expectedVersion?: number | null;
  expectedHash?: string;
  policyId?: string;
  capabilityClass?: CapabilityClass;
  egressClass?: EgressClass;
  budgetAccountId?: string;
  modelRouteRef?: string | null;
  controlAction?: GatewayOperationRequest["controlAction"];
  sourceStopEpoch?: number | null;
  requiredFenceSet?: readonly FenceBinding[];
}>;

/**
 * A repository transaction bound to one gateway operation.  `entitySet` is
 * deliberately explicit: a composite operation must declare every row it may
 * mutate before the gateway opens its transaction.  This prevents a caller
 * from stitching several single-row operations together and calling the
 * result atomic.
 */
export type GatewayMutationTransactionInput = Readonly<{
  operationId: string;
  operationKind: OperationKind;
  ownerProcess?: OwnerProcess;
  entitySet: readonly EntityBinding[];
  identity: Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }>;
  policyId?: string;
  capabilityClass?: CapabilityClass;
  egressClass?: EgressClass;
  budgetAccountId?: string;
  modelRouteRef?: string | null;
  controlAction?: GatewayOperationRequest["controlAction"];
  sourceStopEpoch?: number | null;
  requiredFenceSet?: readonly FenceBinding[];
  requestHash?: string;
  idempotencyKey?: string;
}>;

export type GatewayExternalAttemptInput<T> = Readonly<{
  operationId: string;
  operationKind: OperationKind;
  ownerProcess?: OwnerProcess;
  endpointClass: ClosedExternalRequest["endpointClass"];
  providerResource: string;
  routeId: string;
  method?: ClosedExternalRequest["method"];
  externalIdempotencyKey: string;
  reconcileKey: string;
  headers?: readonly Readonly<{ name: string; valueSha256: string }>[];
  query?: readonly Readonly<{ name: string; value: string }>[];
  bodySha256?: string | null;
  identity: Readonly<{
    sourceId: string | null;
    candidateId: string | null;
    publicationId: string | null;
    publicId: string | null;
  }>;
  entityKind: EntityKind;
  entityId: string;
  expectedVersion?: number | null;
  expectedHash?: string;
  policyId?: string;
  capabilityClass?: CapabilityClass;
  egressClass?: EgressClass;
  budgetAccountId?: string;
  modelRouteRef?: string | null;
  sourceStopEpoch?: number | null;
  requiredFenceSet?: readonly FenceBinding[];
  /** The adapter must do every DNS/socket/HTTP/model call inside this callback. */
  execute: (
    handle: StartedAttemptHandle,
  ) => Promise<Readonly<{ value: T; response: ClosedExternalResponse }>>;
}>;

export type GatewayExternalReconcileInput<T> = Readonly<{
  reconcileKey: string;
  execute: (
    handle: ReconcileRequiredHandle,
  ) => Promise<Readonly<{ value: T; response: ClosedExternalResponse }>>;
}>;

export type GatewayMutationPort = Readonly<{
  mutate(input: GatewayMutationPortInput): number;
  runTransaction?<T>(
    input: GatewayMutationTransactionInput,
    callback: (mutate: (input: GatewayWriteInput) => number) => T,
  ): T;
  runExternal?<T>(input: GatewayExternalAttemptInput<T>): Promise<T>;
  runReconcile?<T>(input: GatewayExternalReconcileInput<T>): Promise<T>;
  prepareUnstartedProjectionLeaseRetry?(deliveryId: string): boolean;
  recordProjectionReconcileAttention?(deliveryId: string, reasonCode: string): void;
}>;

export type XManualAuthorityPort = Readonly<{
  mutateXManual(input: Readonly<{
    operationId: string;
    idempotencyKey: string;
    mutation: XManualGatewayMutation;
  }>): number;
}>;

export type QuickLaunchAuthorityPort = Readonly<{
  transitionAuthority(input: QuickLaunchAuthorityTransition): Readonly<{
    operationId: string;
    capabilityId: QuickLaunchAuthorityCapability;
    state: "closed" | "enabled";
    version: number;
    receiptSha256: string;
  }>;
}>;

export type SourceRegistryAuthorityPort = Readonly<{
  mutateSourceRegistry(input: Readonly<SourceRegistryGatewayMutation & { operationId: string }>): number;
}>;

export type BilingualSafetyAuthorityPort = Readonly<{
  commitBilingualSafetyDecision(
    authorization: BilingualSafetyAuthorization,
    input: BilingualSafetyDecisionInput,
  ): BilingualSafetyDecisionReceipt;
  commitBilingualApproval(
    authorization: BilingualApprovalAuthorization,
    input: BilingualApprovalInput,
  ): BilingualApprovalReceipt;
}>;

export type BilingualPublicationAuthorityPort = Readonly<{
  commitBilingualInitialPublication(
    authorization: BilingualPublicationAuthorization,
    input: BilingualInitialPublicationInput,
  ): BilingualPublicationReceipt;
  activateBilingualProjection(
    authorization: BilingualPublicationAuthorization,
    input: BilingualProjectionActivationInput,
  ): BilingualPublicationReceipt;
  commitBilingualWithdrawal(
    authorization: BilingualWithdrawalAuthorization,
    input: BilingualWithdrawalInput,
  ): BilingualPublicationReceipt;
}>;

type HandoffProvider = () => OwnerSupervisorHandoff;

/**
 * Small adapter for legacy repositories.  It deliberately accepts a
 * supervisor-issued handoff provider; callers cannot manufacture a capability
 * by passing release hashes alone.  The provider is expected to return a
 * freshly persisted, one-time handoff for every mutation operation.
 */
export class SqliteGatewayMutationPort implements GatewayMutationPort, XManualAuthorityPort, QuickLaunchAuthorityPort, SourceRegistryAuthorityPort, BilingualSafetyAuthorityPort, BilingualPublicationAuthorityPort {
  private readonly database: DatabaseSync;
  private readonly gateway: SqliteInternalOperationGateway;
  private readonly ownerProcess: OwnerProcess;
  private readonly handoffProvider: HandoffProvider;
  private readonly now: () => Date;
  private readonly xManualAfterAuthorizeInjector: (() => void) | null;
  private readonly reconcileHandles = new Map<string, ReconcileRequiredHandle>();

  public constructor(
    input: Readonly<{
      database: DatabaseSync;
      gateway: SqliteInternalOperationGateway;
      ownerProcess: OwnerProcess;
      handoffProvider: HandoffProvider;
      now?: () => Date;
      xManualAfterAuthorizeInjector?: () => void;
    }>,
  ) {
    this.database = input.database;
    this.gateway = input.gateway;
    this.ownerProcess = input.ownerProcess;
    this.handoffProvider = input.handoffProvider;
    this.now = input.now ?? (() => new Date());
    this.xManualAfterAuthorizeInjector = input.xManualAfterAuthorizeInjector ?? null;
  }

  public transitionAuthority(input: QuickLaunchAuthorityTransition): Readonly<{
    operationId: string;
    capabilityId: QuickLaunchAuthorityCapability;
    state: "closed" | "enabled";
    version: number;
    receiptSha256: string;
  }> {
    return this.gateway.transitionQuickLaunchAuthority(this.handoffProvider(), input);
  }

  public mutateSourceRegistry(input: Readonly<SourceRegistryGatewayMutation & { operationId: string }>): number {
    const source = this.database.prepare("SELECT source_id,source_kind,source_safety_epoch,identity_sha256 FROM source_registry_v1 WHERE source_id=?").get(input.sourceId) as Record<string, unknown> | undefined;
    assert(source !== undefined, "SOURCE_NOT_FOUND");
    assert(source.source_kind !== "x_page" || input.action !== "retire", "X_PAGE_RETIRE_SUCCESSOR_REQUIRED");
    const xAdmissionSchema = source.source_kind === "x_page" && this.database.prepare("SELECT 1 FROM sqlite_schema WHERE name='x_page_source_admission_v1' AND type='table'").get() !== undefined;
    assert(!xAdmissionSchema || input.action === "disable", "X_PAGE_TRUSTED_READMISSION_REQUIRED");
    const execute = () => {
    const legacy = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(input.sourceId) as Record<string, unknown> | undefined;
    const capability = this.prepareCapability({
      operationId: input.operationId,
      operationKind: input.action === "retire" ? "source_delete" : source.source_kind === "x_page" && !xAdmissionSchema ? "x_page_source_update" : "source_update",
      ownerProcess: "admin_http",
      entityKind: "source",
      entityId: input.sourceId,
      mutationKind: input.action === "retire" ? "delete" : "update",
      statement: "UPDATE source SET enabled=enabled WHERE source_id=?",
      parameters: [input.sourceId],
      identity: { sourceId: input.sourceId, candidateId: null, publicationId: null, publicId: null },
      expectedVersion: xAdmissionSchema ? input.expectedRevision : null,
      expectedHash: xAdmissionSchema ? String(source.identity_sha256) : ZERO,
      capabilityClass: "control",
      egressClass: "none",
      policyId: input.action === "retire" ? "p-source-delete-paused" : source.source_kind === "x_page" ? "p-x-page-source-update-paused" : "p-source-update-paused",
      sourceStopEpoch: legacy === undefined ? Number(source.source_safety_epoch) : Number(legacy.stop_epoch)
    });
    return this.gateway.runSourceRegistryMutation(capability, input);
    };
    return xAdmissionSchema ? this.gateway.runAtomicAdmission(execute) : execute();
  }

  /**
   * Admin safety decisions use the browser-bound request hash verbatim.  The
   * source binding is always read from the same database here; callers cannot
   * substitute registry revision or identity truth.
   */
  public commitBilingualSafetyDecision(
    authorization: BilingualSafetyAuthorization,
    input: BilingualSafetyDecisionInput,
  ): BilingualSafetyDecisionReceipt {
    assert(this.ownerProcess === "admin_http", "BILINGUAL_SAFETY_OWNER_INVALID");
    assert(authorization.operationId.length > 0 && HASH.test(authorization.bodyHash), "BILINGUAL_SAFETY_AUTHORIZATION_INVALID");
    const source = this.database.prepare(
      "SELECT revision,identity_sha256,source_safety_epoch FROM source_registry_v1 WHERE source_id=?",
    ).get(input.sourceId) as Record<string, unknown> | undefined;
    assert(source !== undefined && HASH.test(String(source.identity_sha256)), "BILINGUAL_SAFETY_SOURCE_AUTHORITY_INVALID");
    const legacy = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(input.sourceId) as Record<string, unknown> | undefined;
    const entitySet: readonly EntityBinding[] = Object.freeze([
      Object.freeze({
        entityKind: "candidate" as const,
        entityId: input.candidateId,
        identitySelector: "candidate_id" as const,
        expectedVersion: input.sourceRevision,
        expectedHash: input.inputContentHash,
      }),
      Object.freeze({
        entityKind: "source" as const,
        entityId: input.sourceId,
        identitySelector: "source_id" as const,
        expectedVersion: Number(source.revision),
        expectedHash: String(source.identity_sha256),
      }),
    ]);
    const capability = this.prepareCapability({
      operationId: authorization.operationId,
      operationKind: "review",
      ownerProcess: "admin_http",
      entitySet,
      identity: { sourceId: input.sourceId, candidateId: input.candidateId, publicationId: null, publicId: null },
      capabilityClass: "db_mutation",
      egressClass: "none",
      sourceStopEpoch: legacy === undefined ? Number(source.source_safety_epoch) : Number(legacy.stop_epoch),
      requestHashOverride: authorization.bodyHash,
      idempotencyKeyOverride: `safety-${authorization.operationId}`,
    }, entitySet);
    return this.gateway.commitBilingualLineageSafetyDecision(capability, authorization, input);
  }

  public commitBilingualApproval(
    authorization: BilingualApprovalAuthorization,
    input: BilingualApprovalInput,
  ): BilingualApprovalReceipt {
    assert(this.ownerProcess === "admin_http", "BILINGUAL_APPROVAL_OWNER_INVALID");
    const bundle = this.database.prepare(
      `SELECT bundle.bundle_hash,lineage.source_id,lineage.source_revision,lineage.input_content_hash
         FROM bilingual_bundle_v1 bundle JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
        WHERE bundle.candidate_id=? AND bundle.revision=? AND bundle.state='reviewable'`,
    ).get(input.candidateId, input.expectedBundleRevision) as Record<string, unknown> | undefined;
    assert(bundle !== undefined, "BILINGUAL_APPROVAL_BUNDLE_STALE");
    const sourceId = String(bundle.source_id);
    const source = this.database.prepare("SELECT revision,identity_sha256,source_safety_epoch FROM source_registry_v1 WHERE source_id=?").get(sourceId) as Record<string, unknown> | undefined;
    assert(source !== undefined && HASH.test(String(source.identity_sha256)), "BILINGUAL_APPROVAL_SOURCE_AUTHORITY_INVALID");
    const legacy = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(sourceId) as Record<string, unknown> | undefined;
    const entitySet: readonly EntityBinding[] = Object.freeze([
      Object.freeze({ entityKind: "candidate" as const, entityId: input.candidateId, identitySelector: "candidate_id" as const, expectedVersion: input.expectedBundleRevision, expectedHash: String(bundle.bundle_hash) }),
      Object.freeze({ entityKind: "source" as const, entityId: sourceId, identitySelector: "source_id" as const, expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) }),
    ]);
    const capability = this.prepareCapability({
      operationId: authorization.operationId,
      operationKind: "review",
      ownerProcess: "admin_http",
      entitySet,
      identity: { sourceId, candidateId: input.candidateId, publicationId: null, publicId: null },
      capabilityClass: "db_mutation",
      egressClass: "none",
      sourceStopEpoch: legacy === undefined ? Number(source.source_safety_epoch) : Number(legacy.stop_epoch),
      requestHashOverride: authorization.bodyHash,
      idempotencyKeyOverride: `approval-${authorization.operationId}`,
    }, entitySet);
    return this.gateway.commitBilingualApproval(capability, authorization, input);
  }

  public commitBilingualInitialPublication(
    authorization: BilingualPublicationAuthorization,
    input: BilingualInitialPublicationInput,
  ): BilingualPublicationReceipt {
    assert(this.ownerProcess === "admin_http", "BILINGUAL_PUBLICATION_OWNER_INVALID");
    const existing = this.database.prepare("SELECT publication_id FROM bilingual_publication_v1 WHERE operation_id=?").get(authorization.operationId) as Record<string, unknown> | undefined;
    if (existing !== undefined) return this.readBilingualPublicationReceipt(String(existing.publication_id));
    const bundle = this.database.prepare(`SELECT bundle.bundle_hash,lineage.source_id,lineage.source_revision,lineage.input_content_hash,lineage.public_id
      FROM bilingual_bundle_v1 bundle JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
      WHERE bundle.candidate_id=? AND bundle.revision=? AND bundle.state='reviewable'`).get(input.candidateId, input.expectedBundleRevision) as Record<string, unknown> | undefined;
    assert(bundle !== undefined && bundle.public_id === input.publicId, "BILINGUAL_PUBLICATION_BUNDLE_STALE");
    const source = this.database.prepare("SELECT revision,identity_sha256,source_safety_epoch FROM source_registry_v1 WHERE source_id=?").get(String(bundle.source_id)) as Record<string, unknown> | undefined;
    const legacy = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=? AND enabled=1").get(String(bundle.source_id)) as Record<string, unknown> | undefined;
    assert(source !== undefined && HASH.test(String(source.identity_sha256)) && legacy !== undefined, "BILINGUAL_PUBLICATION_SOURCE_AUTHORITY_INVALID");
    const entitySet: readonly EntityBinding[] = Object.freeze([
      Object.freeze({ entityKind: "candidate" as const, entityId: input.candidateId, identitySelector: "candidate_id" as const, expectedVersion: input.expectedBundleRevision, expectedHash: String(bundle.bundle_hash) }),
      Object.freeze({ entityKind: "source" as const, entityId: String(bundle.source_id), identitySelector: "source_id" as const, expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) }),
      Object.freeze({ entityKind: "publication" as const, entityId: input.publicationId, identitySelector: "publication_id" as const, expectedVersion: 0, expectedHash: input.artifact.payloadHash }),
      Object.freeze({ entityKind: "published_projection" as const, entityId: input.publicId, identitySelector: "public_id" as const, expectedVersion: 0, expectedHash: input.artifact.payloadHash }),
    ]);
    const capability = this.prepareCapability({
      operationId: authorization.operationId, operationKind: "publish", ownerProcess: "admin_http", entitySet,
      identity: { sourceId: String(bundle.source_id), candidateId: input.candidateId, publicationId: input.publicationId, publicId: input.publicId },
      capabilityClass: "db_mutation", egressClass: "none", sourceStopEpoch: Number(legacy.stop_epoch),
      requestHashOverride: authorization.bodyHash, idempotencyKeyOverride: `bilingual-publication-${authorization.operationId}`,
    }, entitySet);
    return this.gateway.commitBilingualInitialPublication(capability, authorization, input);
  }

  public activateBilingualProjection(
    authorization: BilingualPublicationAuthorization,
    input: BilingualProjectionActivationInput,
  ): BilingualPublicationReceipt {
    assert(this.ownerProcess === "admin_http", "BILINGUAL_PUBLICATION_OWNER_INVALID");
    const existing = this.database.prepare("SELECT publication_id FROM bilingual_publication_outbox_v1 WHERE operation_id=?").get(authorization.operationId) as Record<string, unknown> | undefined;
    if (existing !== undefined) return this.readBilingualPublicationReceipt(String(existing.publication_id));
    const publication = this.database.prepare(`SELECT publication.bundle_hash,bundle.candidate_id,bundle.revision AS bundle_revision,lineage.source_id
      FROM bilingual_publication_v1 publication JOIN bilingual_bundle_v1 bundle ON bundle.bundle_id=publication.bundle_id
      JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
      WHERE publication.publication_id=? AND publication.status='published'`).get(input.publicationId) as Record<string, unknown> | undefined;
    assert(publication !== undefined && publication.candidate_id === input.candidateId && Number(publication.bundle_revision) === input.expectedBundleRevision, "BILINGUAL_PUBLICATION_STALE");
    const source = this.database.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id=?").get(String(publication.source_id)) as Record<string, unknown> | undefined;
    const legacy = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=? AND enabled=1").get(String(publication.source_id)) as Record<string, unknown> | undefined;
    assert(source !== undefined && HASH.test(String(source.identity_sha256)) && legacy !== undefined, "BILINGUAL_PUBLICATION_SOURCE_AUTHORITY_INVALID");
    const entitySet: readonly EntityBinding[] = Object.freeze([
      Object.freeze({ entityKind: "candidate" as const, entityId: input.candidateId, identitySelector: "candidate_id" as const, expectedVersion: input.expectedBundleRevision, expectedHash: String(publication.bundle_hash) }),
      Object.freeze({ entityKind: "source" as const, entityId: String(publication.source_id), identitySelector: "source_id" as const, expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) }),
      Object.freeze({ entityKind: "publication" as const, entityId: input.publicationId, identitySelector: "publication_id" as const, expectedVersion: 1, expectedHash: input.artifact.payloadHash }),
      Object.freeze({ entityKind: "published_projection" as const, entityId: input.publicId, identitySelector: "public_id" as const, expectedVersion: 1, expectedHash: input.artifact.payloadHash }),
    ]);
    const capability = this.prepareCapability({
      operationId: authorization.operationId, operationKind: "publish", ownerProcess: "admin_http", entitySet,
      identity: { sourceId: String(publication.source_id), candidateId: input.candidateId, publicationId: input.publicationId, publicId: input.publicId },
      capabilityClass: "db_mutation", egressClass: "none", sourceStopEpoch: Number(legacy.stop_epoch),
      requestHashOverride: authorization.bodyHash, idempotencyKeyOverride: `bilingual-projection-${authorization.operationId}`,
    }, entitySet);
    return this.gateway.activateBilingualProjection(capability, authorization, input);
  }

  public commitBilingualWithdrawal(
    authorization: BilingualWithdrawalAuthorization,
    input: BilingualWithdrawalInput,
  ): BilingualPublicationReceipt {
    assert(this.ownerProcess === "admin_http", "BILINGUAL_WITHDRAWAL_OWNER_INVALID");
    const existing = this.database.prepare("SELECT publication_id FROM bilingual_publication_v1 WHERE operation_id=?").get(authorization.operationId) as Record<string, unknown> | undefined;
    if (existing !== undefined) return this.readBilingualPublicationReceipt(String(existing.publication_id));
    const previous = this.database.prepare(`SELECT publication.payload_hash,publication.public_id,bundle.candidate_id,bundle.revision AS bundle_revision,
      bundle.bundle_hash,lineage.source_id
      FROM bilingual_publication_v1 publication JOIN bilingual_bundle_v1 bundle ON bundle.bundle_id=publication.bundle_id
      JOIN bilingual_candidate_lineage_v1 lineage ON lineage.candidate_id=bundle.candidate_id
      WHERE publication.publication_id=? AND publication.revision=? AND publication.status='published'`).get(input.publicationId, input.expectedRevision) as Record<string, unknown> | undefined;
    assert(previous !== undefined && previous.public_id === input.publicId, "BILINGUAL_WITHDRAW_PUBLICATION_STALE");
    const source = this.database.prepare("SELECT revision,identity_sha256 FROM source_registry_v1 WHERE source_id=?").get(String(previous.source_id)) as Record<string, unknown> | undefined;
    assert(source !== undefined && HASH.test(String(source.identity_sha256)), "BILINGUAL_WITHDRAWAL_SOURCE_AUTHORITY_INVALID");
    const entitySet: readonly EntityBinding[] = Object.freeze([
      Object.freeze({ entityKind: "publication" as const, entityId: input.publicationId, identitySelector: "publication_id" as const, expectedVersion: input.expectedRevision, expectedHash: String(previous.payload_hash) }),
      Object.freeze({ entityKind: "published_projection" as const, entityId: input.publicId, identitySelector: "public_id" as const, expectedVersion: input.expectedRevision, expectedHash: String(previous.payload_hash) }),
      Object.freeze({ entityKind: "candidate" as const, entityId: String(previous.candidate_id), identitySelector: "bound_child" as const, expectedVersion: Number(previous.bundle_revision), expectedHash: String(previous.bundle_hash) }),
      Object.freeze({ entityKind: "source" as const, entityId: String(previous.source_id), identitySelector: "bound_child" as const, expectedVersion: Number(source.revision), expectedHash: String(source.identity_sha256) }),
    ]);
    const currentPhase = phase((this.database.prepare("SELECT phase FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown>).phase);
    const capability = this.prepareCapability({
      operationId: authorization.operationId, operationKind: "withdraw", ownerProcess: "admin_http", entitySet,
      identity: { sourceId: null, candidateId: null, publicationId: input.publicationId, publicId: input.publicId },
      policyId: `p-withdraw-${currentPhase}`, capabilityClass: "db_mutation", egressClass: "none", sourceStopEpoch: null,
      requestHashOverride: authorization.bodyHash, idempotencyKeyOverride: `bilingual-withdrawal-${authorization.operationId}`,
    }, entitySet);
    return this.gateway.commitBilingualWithdrawal(capability, authorization, input);
  }

  private readBilingualPublicationReceipt(publicationId: string): BilingualPublicationReceipt {
    const value = this.database.prepare(`SELECT publication.publication_id,publication.public_id,publication.revision,publication.status,
      projection.projection_id,projection.generation,projection.payload_hash,outbox.delivery_id
      FROM bilingual_publication_v1 publication JOIN bilingual_public_projection_v1 projection ON projection.publication_id=publication.publication_id
      LEFT JOIN bilingual_publication_outbox_v1 outbox ON outbox.publication_id=publication.publication_id
      WHERE publication.publication_id=?`).get(publicationId) as Record<string, unknown> | undefined;
    assert(value !== undefined, "BILINGUAL_PUBLICATION_STALE");
    const status = value.status === "withdrawn" ? "withdrawn" : value.delivery_id === null ? "staged" : "published";
    return Object.freeze({ publicationId: String(value.publication_id), projectionId: String(value.projection_id), publicId: String(value.public_id),
      revision: Number(value.revision), generation: Number(value.generation), projectionHash: String(value.payload_hash),
      outboxDeliveryId: value.delivery_id === null ? null : String(value.delivery_id), status });
  }

  public mutate(input: GatewayMutationPortInput): number {
    const control = this.database
      .prepare("SELECT * FROM internal_control WHERE singleton_id=1")
      .get() as Record<string, unknown> | undefined;
    assert(control !== undefined, "INTERNAL_CONTROL_MISSING");
    const currentPhase = phase(control.phase);
    const capabilityClass =
      input.capabilityClass ??
      (input.operationKind === "source_create" ||
      input.operationKind === "source_update" ||
      input.operationKind === "source_delete"
        ? "control"
        : "db_mutation");
    const egressClass = input.egressClass ?? "none";
    const policyId =
      input.policyId ??
      this.defaultPolicy(input.operationKind, currentPhase, egressClass);
    const expectedHash = input.expectedHash ?? ZERO;
    assert(HASH.test(expectedHash), "EXPECTED_ENTITY_HASH_INVALID");
    const identity = Object.freeze({ ...input.identity });
    let sourceStopEpoch = input.sourceStopEpoch ?? null;
    if (input.operationKind === "collect") {
      assert(this.ownerProcess === "rss_collector" && identity.sourceId !== null, "COLLECT_SOURCE_BINDING_REQUIRED");
      const source = this.database.prepare("SELECT stop_epoch FROM source WHERE source_id=?").get(identity.sourceId);
      assert(source !== undefined && (sourceStopEpoch === null || sourceStopEpoch === Number(source.stop_epoch)), "COLLECT_SOURCE_STALE");
      sourceStopEpoch = Number(source.stop_epoch);
      if (input.entityKind === "rss_media") {
        assert(input.entityId === input.parameters?.[0] && identity.candidateId === input.entityId, "COLLECT_MEDIA_IDENTITY_INVALID");
      }
    }
    const identitySelector = this.identitySelector(input.entityKind);
    const entitySet: EntityBinding[] = [
      Object.freeze({
        entityKind: input.entityKind,
        entityId: id(input.entityId, "ENTITY_ID_INVALID"),
        identitySelector,
        expectedVersion: input.expectedVersion ?? null,
        expectedHash,
      }),
    ];
    if (input.operationKind === "collect") {
      for (const [selector, kind, value] of [["source_id", "source", identity.sourceId], ["candidate_id", "candidate", identity.candidateId]] as const) {
        if (value !== null && !entitySet.some(binding => binding.identitySelector === selector && binding.entityId === value)) {
          entitySet.push({ entityKind: kind, entityId: value, identitySelector: selector, expectedVersion: null, expectedHash: ZERO });
        }
      }
    }
    const requiredFenceSet =
      input.requiredFenceSet ??
      this.readRequiredFenceSet(policyId, identity, control);
    const operationId = id(input.operationId, "OPERATION_ID_INVALID");
    const requestBody = {
      operationId,
      operationKind: input.operationKind,
      ownerProcess: this.ownerProcess,
      entityKind: input.entityKind,
      entityId: input.entityId,
      mutationKind: input.mutationKind,
      statement: input.statement,
      parameters: input.parameters ?? [],
      identity,
      phase: currentPhase,
      egressClass,
      policyId,
    };
    const requestHash = sha256(
      `f1plus1-gateway-mutation-v1\n${canonicalJsonV1(requestBody)}`,
    );
    const requestFingerprint = sha256(
      `f1plus1-gateway-mutation-fingerprint-v1\n${requestHash}`,
    );
    const handoff = this.handoffProvider();
    const capability = this.gateway.authorize(
      this.gateway.request(handoff, {
        schemaVersion: "operation-request-v1",
        operationId,
        idempotencyKey: `idempotency-${operationId}`,
        operationKind: input.operationKind,
        ownerProcess: this.ownerProcess,
        capabilityClass,
        policyId,
        authorizationHandoffId: handoff.handoffId,
        controlAction: input.controlAction ?? null,
        identity,
        entitySet,
        requiredFenceSet,
        expected: {
          controlVersion: Number(control.version),
          entityVersion: input.expectedVersion ?? null,
          entityHash: expectedHash,
          schemaSha256: this.gateway.expectedSchemaSha256(),
          releaseSha256: handoff.releaseSha256,
          manifestSha256: handoff.manifestSha256,
          sourceStopEpoch,
          writerEpoch: Number(control.writer_epoch),
          epochs: {
            sourceConfig: Number(control.source_config_epoch),
            sourceSafety: Number(control.source_safety_epoch),
            authorization: Number(control.authorization_version),
            policy: Number(control.policy_epoch),
            recovery: Number(control.recovery_epoch),
          },
        },
        phase: currentPhase,
        egressClass,
        budgetRequest:
          egressClass === "none"
            ? null
            : {
                reservationId: `reservation-${operationId}`,
                accountId: input.budgetAccountId ?? (input.operationKind === "collect" ? "acct-rss" : "gateway-unconfigured"),
                units: 1,
              },
        modelRouteRef: input.modelRouteRef ?? null,
        requestHash,
        requestFingerprint,
      }),
    );
    return this.gateway.runMutationTransaction(capability, (mutate) =>
      mutate({
        entityKind: input.entityKind,
        entityId: input.entityId,
        mutationKind: input.mutationKind,
        expectedVersion: input.expectedVersion ?? null,
        expectedHash,
        statement: input.statement,
        parameters: input.parameters,
      }),
    );
  }

  /**
   * Schema-8 Admin-only manual X entrypoint. The caller supplies domain data;
   * this port owns the handoff, schema identity, operation request, capability,
   * and the only writer that can issue an x_manual permit.
   */
  public mutateXManual(input: Readonly<{
    operationId: string;
    idempotencyKey: string;
    mutation: XManualGatewayMutation;
  }>): number {
    assert(this.ownerProcess === "admin_http", "X_MANUAL_OWNER_INVALID");
    const control = this.database.prepare("SELECT * FROM internal_control WHERE singleton_id=1").get() as Record<string, unknown> | undefined;
    assert(control !== undefined && control.phase === "disabled", "X_MANUAL_PHASE_INVALID");
    const baseOperationId = id(input.operationId, "OPERATION_ID_INVALID");
    const submissionId = id(input.mutation.submissionId, "ENTITY_ID_INVALID");
    const baseIdempotencyKey = id(input.idempotencyKey, "IDEMPOTENCY_KEY_INVALID");
    const conflicting = this.database.prepare(
      `SELECT x.semantic_kind,x.submission_id,x.expected_revision
         FROM internal_operation o
         LEFT JOIN x_manual_operation x ON x.operation_id=o.operation_id
        WHERE o.idempotency_key=?`,
    ).get(baseIdempotencyKey) as Record<string, unknown> | undefined;
    assert(
      conflicting === undefined ||
        conflicting.semantic_kind === input.mutation.semanticKind &&
        conflicting.submission_id === submissionId &&
        Number(conflicting.expected_revision) === input.mutation.expectedRevision,
      "IDEMPOTENCY_CONFLICT",
    );
    const attempts = this.database.prepare(
      `SELECT o.operation_id,o.state,o.result_hash,o.reason_code
         FROM x_manual_operation x
         JOIN internal_operation o ON o.operation_id=x.operation_id
        WHERE x.semantic_kind=? AND x.submission_id=? AND x.expected_revision=?
        ORDER BY x.rowid DESC`,
    ).all(input.mutation.semanticKind, submissionId, input.mutation.expectedRevision) as Array<Record<string, unknown>>;
    const latest = attempts[0];
    if (latest?.state === "succeeded") return 0;
    if (latest?.state === "requested" || latest?.state === "authorized") {
      this.gateway.cancelStaleXManualOperation(String(latest.operation_id), input.mutation.nowIso);
    } else if (latest !== undefined) {
      assert(latest.state === "cancelled" || latest.state === "terminal_failed" || latest.state === "reconcile_required", "X_MANUAL_RETRY_STATE_INVALID");
    }
    const retryNumber = attempts.length;
    const operationId = id(retryNumber === 0 ? baseOperationId : `${baseOperationId}.retry${retryNumber}`, "OPERATION_ID_INVALID");
    const idempotencyKey = id(retryNumber === 0 ? baseIdempotencyKey : `${baseIdempotencyKey}:retry${retryNumber}`, "IDEMPOTENCY_KEY_INVALID");
    const expectedHash = sha256(`f1plus1-x-manual-expected-v1\n${submissionId}\n${input.mutation.expectedRevision}`);
    const entitySet: readonly EntityBinding[] = [Object.freeze({
      entityKind: "legacy_admin_operation",
      entityId: submissionId,
      identitySelector: "bound_child",
      expectedVersion: input.mutation.expectedRevision,
      expectedHash,
    })];
    const requestBody = {
      schemaVersion: "x-manual-operation-request-v1",
      operationId,
      idempotencyKey,
      semanticKind: input.mutation.semanticKind,
      submissionId,
      expectedRevision: input.mutation.expectedRevision,
      phase: "disabled",
      egressClass: "none",
      ownerProcess: this.ownerProcess,
    };
    const requestHash = sha256(`f1plus1-x-manual-request-v1\n${canonicalJsonV1(requestBody)}`);
    const requestFingerprint = sha256(`f1plus1-x-manual-request-fingerprint-v1\n${requestHash}`);
    const handoff = this.handoffProvider();
    const capability = this.gateway.authorize(this.gateway.request(handoff, {
      schemaVersion: "operation-request-v1",
      operationId,
      idempotencyKey,
      operationKind: "phase_control",
      ownerProcess: "admin_http",
      capabilityClass: "control",
      policyId: "p-phase-control-disabled",
      authorizationHandoffId: handoff.handoffId,
      controlAction: "fence_update",
      identity: { sourceId: null, candidateId: null, publicationId: null, publicId: null },
      entitySet,
      requiredFenceSet: [],
      expected: {
        controlVersion: Number(control.version),
        entityVersion: input.mutation.expectedRevision,
        entityHash: expectedHash,
        schemaSha256: this.gateway.expectedSchemaSha256(),
        releaseSha256: handoff.releaseSha256,
        manifestSha256: handoff.manifestSha256,
        sourceStopEpoch: null,
        writerEpoch: Number(control.writer_epoch),
        epochs: {
          sourceConfig: Number(control.source_config_epoch),
          sourceSafety: Number(control.source_safety_epoch),
          authorization: Number(control.authorization_version),
          policy: Number(control.policy_epoch),
          recovery: Number(control.recovery_epoch),
        },
      },
      phase: "disabled",
      egressClass: "none",
      budgetRequest: null,
      modelRouteRef: null,
      requestHash,
      requestFingerprint,
      xManualAuthority: {
        semanticKind: input.mutation.semanticKind,
        submissionId,
        expectedRevision: input.mutation.expectedRevision,
      },
    }));
    this.xManualAfterAuthorizeInjector?.();
    return this.gateway.runXManualMutation(capability, input.mutation);
  }

  /**
   * Run a composite repository mutation under one operation and one SQLite
   * transaction.  The repository receives only the gateway-owned writer; it
   * never receives the database handle and cannot open a second transaction.
   */
  /** Admission + mutation atomicity for capture import; no additional SQL authority. */
  public runAtomicAdmission<T>(callback: () => T): T {
    return this.gateway.runAtomicAdmission(callback);
  }

  public runTransaction<T>(
    input: GatewayMutationTransactionInput,
    callback: (mutate: (mutation: GatewayWriteInput) => number) => T,
  ): T {
    if (input.policyId === "p-x-page-refine-store-live") input = { ...input, entitySet: xPageRefinementReadBindings(this.database, input.entitySet, input.identity, this.now()) };
    const prepared = this.prepareCapability(
      {
        ...input,
        requestHashOverride: input.requestHash,
        idempotencyKeyOverride: input.idempotencyKey,
        capabilityClass: input.capabilityClass ?? "db_mutation",
        egressClass: input.egressClass ?? "none",
        entityKind: input.entitySet[0]?.entityKind,
        entityId: input.entitySet[0]?.entityId,
        mutationKind:
          input.entitySet[0]?.entityKind === "internal_control"
            ? "update"
            : "insert",
        statement: "",
        parameters: [],
      },
      input.entitySet,
    );
    return this.gateway.runMutationTransaction(prepared, callback);
  }

  /**
   * Establish and execute one durable external attempt.  The call to the
   * adapter is reachable only through `gateway.executeExternal`, which marks
   * the attempt started after the intent transaction commits.  Existing
   * idempotency/reconcile keys fail closed, so a lost response can only be
   * reconciled against the same attempt.
   */
  public async runExternal<T>(
    input: GatewayExternalAttemptInput<T>,
  ): Promise<T> {
    const xPublication = input.identity.publicationId && input.entityKind === "projection_outbox"
      ? this.database.prepare("SELECT s.source_kind FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id JOIN source_registry_v1 s ON s.source_id=c.source_id WHERE p.publication_id=?").get(input.identity.publicationId) : undefined;
    const xDelivery = ["p-x-page-projection-live", "p-x-page-reconcile-live"].includes(String(input.policyId)) || xPublication?.source_kind === "x_page"
      ? readXPageCommittedDelivery(this.database, input.entityId, {schemaSha256:this.gateway.expectedSchemaSha256(),releaseSha256:this.gateway.expectedReleaseSha256(),manifestSha256:this.gateway.expectedManifestSha256(),
          verifiedFullManifestSha256:this.gateway.verifiedRssAutomaticFullManifest(),verifiedFallbackManifestSha256:this.gateway.verifiedRssAutomaticFallbackManifest(),now:this.now()}) : null;
    if(xDelivery) {
      assert(input.entityKind === "projection_outbox", "X_PAGE_DELIVERY_OUTBOX_BINDING_REQUIRED");
      assert(input.policyId === undefined || ["p-x-page-projection-live", "p-x-page-reconcile-live"].includes(input.policyId), "X_PAGE_DELIVERY_POLICY_INVALID");
      assert((input.expectedVersion === undefined || input.expectedVersion === Number(xDelivery.row.snapshot_generation)) && (input.expectedHash === undefined || input.expectedHash === xDelivery.row.task_envelope_hash), "X_PAGE_DELIVERY_OUTBOX_STALE");
      input={...input,policyId:input.operationKind === "reconcile" ? "p-x-page-reconcile-live" : "p-x-page-projection-live",expectedVersion:Number(xDelivery.row.snapshot_generation),expectedHash:String(xDelivery.row.task_envelope_hash),identity:{sourceId:String(xDelivery.row.source_id),candidateId:String(xDelivery.row.candidate_id),publicationId:String(xDelivery.row.publication_id),publicId:String(xDelivery.row.public_id)},sourceStopEpoch:Number(xDelivery.source.stop_epoch)};
    }
    const operationId = id(input.operationId, "OPERATION_ID_INVALID");
    const existing = this.database
      .prepare(
        "SELECT attempt_id,state,operation_id FROM internal_external_attempt WHERE external_idempotency_key=? OR reconcile_key=? LIMIT 1",
      )
      .get(input.externalIdempotencyKey, input.reconcileKey) as
      Record<string, unknown> | undefined;
    assert(existing === undefined, "EXTERNAL_RECONCILE_REQUIRED");
    const route = this.database
      .prepare(
        "SELECT route_id,egress_class,endpoint_class,endpoint_identity_sha256,state FROM route_registry WHERE route_id=?",
      )
      .get(input.routeId) as Record<string, unknown> | undefined;
    assert(
      route !== undefined && route.state === "active",
      "EXTERNAL_ROUTE_UNAVAILABLE",
    );
    const currentPhase = phase(
      (
        this.database
          .prepare("SELECT phase FROM internal_control WHERE singleton_id=1")
          .get() as Record<string, unknown> | undefined
      )?.phase,
    );
    const ownerProcess = input.ownerProcess ?? this.ownerProcess;
    const egressClass =
      input.egressClass ?? (String(route.egress_class) as EgressClass);
    assert(
      String(route.egress_class) === egressClass &&
        String(route.endpoint_class) === input.endpointClass,
      "EXTERNAL_ROUTE_MISMATCH",
    );
    const identity = Object.freeze({ ...input.identity });
    const entityId = id(input.entityId, "ENTITY_ID_INVALID");
    const entitySet: EntityBinding[] = [
      Object.freeze({
        entityKind: input.entityKind,
        entityId,
        identitySelector: this.identitySelector(input.entityKind),
        expectedVersion: input.expectedVersion ?? null,
        expectedHash: input.expectedHash ?? ZERO,
      }),
    ];
    for (const [selector, kind, value] of [
      ["source_id", "source", identity.sourceId], ["candidate_id", "candidate", identity.candidateId],
      ["publication_id", "publication", identity.publicationId], ["public_id", "published_projection", identity.publicId],
    ] as const) {
      if (value !== null && !entitySet.some(binding => binding.identitySelector === selector && binding.entityId === value)) {
        entitySet.push({ entityKind: kind, entityId: value, identitySelector: selector, expectedVersion: null, expectedHash: ZERO });
      }
    }
    if (xDelivery) for (const binding of xPageAutomaticContentBindings(xDelivery.content,xDelivery.target)) {
      const at=entitySet.findIndex(item=>item.entityKind===binding.entityKind&&item.entityId===binding.entityId);
      if(at<0)entitySet.push(binding);else {
        assert((entitySet[at].expectedVersion===null&&entitySet[at].expectedHash===ZERO)||canonicalJsonV1(entitySet[at])===canonicalJsonV1(binding),"X_PAGE_DELIVERY_READ_BINDING_STALE");entitySet[at]=binding;
      }
    }
    if (input.policyId === "p-x-page-refine-live") entitySet.splice(0, entitySet.length, ...xPageRefinementReadBindings(this.database, entitySet, identity, this.now()));
    assert(
      HASH.test(entitySet[0].expectedHash),
      "EXPECTED_ENTITY_HASH_INVALID",
    );
    const control = this.database
      .prepare("SELECT * FROM internal_control WHERE singleton_id=1")
      .get() as Record<string, unknown> | undefined;
    assert(control !== undefined, "INTERNAL_CONTROL_MISSING");
    // Reject a stopped/closed egress before creating an authorized operation;
    // the first durable attempt record is created only after this local gate.
    assertPhaseAllowsExternal(readPhaseSnapshot(this.database), egressClass);
    const capabilityClass = input.capabilityClass ?? "external_attempt";
    const policyId =
      input.policyId ??
      this.defaultPolicy(
        input.operationKind,
        currentPhase,
        egressClass,
        ownerProcess,
        capabilityClass,
      );
    const requiredFenceSet =
      input.requiredFenceSet ??
      this.readRequiredFenceSet(policyId, identity, control);
    const handoff = this.handoffProvider();
    const attemptNonce = randomNonce();
    const externalRequest: ClosedExternalRequest = Object.freeze({
      schemaVersion: "external-request-v1",
      method: input.method ?? "GET",
      endpointClass: input.endpointClass,
      providerResource: input.providerResource,
      routeId: input.routeId,
      externalIdempotencyKey: input.externalIdempotencyKey,
      reconcileKey: input.reconcileKey,
      headers: [...(input.headers ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      query: [...(input.query ?? [])].sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.value.localeCompare(right.value),
      ),
      bodySha256: input.bodySha256 ?? null,
      attemptIdentity: { operationId, attemptNumber: 1, attemptNonce },
      entityIdentity: identity,
      expected: {
        schemaSha256: this.gateway.expectedSchemaSha256(),
        releaseSha256: handoff.releaseSha256,
        manifestSha256: handoff.manifestSha256,
        routeIdentitySha256: String(route.endpoint_identity_sha256),
      },
      epochs: {
        sourceConfig: Number(control.source_config_epoch),
        sourceSafety: Number(control.source_safety_epoch),
        authorization: Number(control.authorization_version),
        policy: Number(control.policy_epoch),
        recovery: Number(control.recovery_epoch),
        writer: Number(control.writer_epoch),
      },
      fenceSetHash: this.fenceSetHash(requiredFenceSet),
    });
    const requestHash = canonicalExternalRequestHash(externalRequest);
    const requestFingerprint = sha256(
      `f1plus1-external-request-fingerprint-v1\n${requestHash}\n${operationId}\n1\n${attemptNonce}`,
    );
    const capability = this.gateway.authorize(
      this.gateway.request(handoff, {
        schemaVersion: "operation-request-v1",
        operationId,
        idempotencyKey: `external-${input.externalIdempotencyKey}`,
        operationKind: input.operationKind,
        ownerProcess,
        capabilityClass,
        policyId,
        authorizationHandoffId: handoff.handoffId,
        controlAction: null,
        identity,
        entitySet,
        requiredFenceSet,
        expected: {
          controlVersion: Number(control.version),
          entityVersion: input.expectedVersion ?? null,
          entityHash: input.expectedHash ?? ZERO,
          schemaSha256: this.gateway.expectedSchemaSha256(),
          releaseSha256: handoff.releaseSha256,
          manifestSha256: handoff.manifestSha256,
          sourceStopEpoch: input.sourceStopEpoch ?? null,
          writerEpoch: Number(control.writer_epoch),
          epochs: {
            sourceConfig: Number(control.source_config_epoch),
            sourceSafety: Number(control.source_safety_epoch),
            authorization: Number(control.authorization_version),
            policy: Number(control.policy_epoch),
            recovery: Number(control.recovery_epoch),
          },
        },
        phase: currentPhase,
        egressClass,
        budgetRequest: {
          reservationId: `reservation-${operationId}`,
          accountId: input.budgetAccountId ?? "gateway-unconfigured",
          units: 1,
        },
        modelRouteRef: input.modelRouteRef ?? null,
        requestHash,
        requestFingerprint,
      }),
    ) as OperationCapability;
    const committed = this.gateway.commitAttemptIntent(
      capability,
      externalRequest,
    );
    let value!: T;
    await this.gateway.executeExternal(
      committed,
      {
        execute: async (started: StartedAttemptHandle) => {
          const result = await input.execute(started);
          value = result.value;
          return result.response;
        },
      },
      (reconcile) => {
        this.reconcileHandles.set(input.reconcileKey, reconcile);
      },
    );
    return value;
  }

  /** Consume a response for the original unknown attempt without creating a new attempt. */
  public async runReconcile<T>(
    input: GatewayExternalReconcileInput<T>,
  ): Promise<T> {
    const handle = this.reconcileHandles.get(input.reconcileKey);
    assert(handle !== undefined, "EXTERNAL_RECONCILE_HANDLE_UNAVAILABLE");
    let value!: T;
    await this.gateway.executeReconcileExternal(handle, {
      execute: async (original: ReconcileRequiredHandle) => {
        const result = await input.execute(original);
        value = result.value;
        return result.response;
      },
    });
    this.reconcileHandles.delete(input.reconcileKey);
    return value;
  }

  /** RSS automatic delivery uses durable original-attempt identity and a new
   * read-only observation grant. The callback receives the genuine GET handle;
   * no capability for the original POST is reconstructed. */
  public async runProjectionReconcile<T>(input: GatewayExternalReconcileInput<T>): Promise<T> {
    assert(this.ownerProcess === "reconciler", "PROJECTION_RECONCILE_OWNER_REQUIRED");
    this.gateway.recoverProjectionReconcileOriginal(input.reconcileKey);
    const settled = this.gateway.settledProjectionReconcileReceipt(input.reconcileKey);
    if (settled !== null) return settled as T;
    const target = this.gateway.projectionReconcileTarget(input.reconcileKey);
    const latest = this.database.prepare("SELECT observed.created_at FROM internal_operation observed JOIN operation_entity_binding binding ON binding.operation_id=observed.operation_id AND binding.entity_kind='projection_outbox' AND binding.entity_id=? WHERE observed.owner_process='reconciler' AND observed.operation_kind='reconcile' ORDER BY observed.created_at DESC LIMIT 1").get(target.deliveryId);
    assert(latest === undefined || this.now().getTime() - Date.parse(String(latest.created_at)) >= 60_000, "PROJECTION_RECONCILE_BACKOFF");
    const operationId = `projection-observe-${randomBytes(24).toString("hex")}`;
    let response!: ClosedExternalResponse;
    let responseBodyJson!: string;
    const value = await this.runExternal({
      operationId, operationKind: "reconcile", ownerProcess: "reconciler", capabilityClass: "reconcile_readonly",
      policyId: target.operation.policy_id === "p-x-page-projection-live" ? "p-x-page-reconcile-live" : `p-reconcile-projection-${readPhaseSnapshot(this.database).phase}`, endpointClass: "projection_deliver",
      providerResource: target.receiptResource, routeId: "route-projection", method: "GET", bodySha256: null,
      externalIdempotencyKey: `observe-${target.attempt.attempt_id}-${operationId}`,
      reconcileKey: `readonly-${target.attempt.attempt_id}-${operationId}`,
      identity: target.request.entityIdentity, entityKind: "projection_outbox", entityId: target.deliveryId,
      expectedVersion: target.generation, expectedHash: target.envelopeHash, egressClass: "projection_private", budgetAccountId: "acct-projection",
      execute: async (handle) => {
        const result = await input.execute({ ...handle, reconcileAfter: handle.startedAt });
        const observed = result.value as Record<string, unknown>;
        assert(observed !== null && typeof observed === "object" && observed.kind === "response"
          && Number.isSafeInteger(observed.status) && Number(observed.status) >= 100 && Number(observed.status) <= 599,
        "PROJECTION_RECONCILE_RESPONSE_INVALID");
        responseBodyJson = JSON.stringify(observed.body);
        response = result.response;
        assert(String(observed.status) === response.providerStatus && response.providerResourceIdentity === target.request.providerResource
          && response.responseBodySha256 === sha256(responseBodyJson), "PROJECTION_RECONCILE_RESPONSE_MISMATCH");
        return { value: result.value, response: { ...response, providerResourceIdentity: target.receiptResource } };
      },
    });
    // A completed GET may truthfully report 404 or unusable receiver data.
    // Its observation stays recorded while the original POST remains unknown.
    assert(/^2\d\d$/.test(response.providerStatus), "PROJECTION_RECONCILE_RECEIPT_UNAVAILABLE");
    this.gateway.validateProjectionReconcileReceipt(input.reconcileKey, responseBodyJson, response);
    this.gateway.settleProjectionReconcile({ reconcileKey: input.reconcileKey, observationOperationId: operationId, responseBodyJson, response });
    return value;
  }

  public prepareUnstartedProjectionLeaseRetry(deliveryId: string): boolean {
    assert(this.ownerProcess === "projection_sender", "PROJECTION_RECONCILE_OWNER_REQUIRED");
    return this.gateway.prepareUnstartedProjectionLeaseRetry(deliveryId);
  }

  public recordProjectionReconcileAttention(deliveryId: string, reasonCode: string): void {
    assert(this.ownerProcess === "projection_sender", "PROJECTION_RECONCILE_OWNER_REQUIRED");
    this.gateway.recordProjectionReconcileAttention(deliveryId, reasonCode);
  }

  private prepareCapability(
    input:
      | GatewayMutationPortInput
      | (GatewayMutationTransactionInput & {
          entityKind?: EntityKind;
          entityId?: string;
          mutationKind?: MutationKind;
          statement?: string;
          parameters?: readonly unknown[];
        } & {
          requestHashOverride?: string;
          idempotencyKeyOverride?: string;
        }),
    providedEntitySet?: readonly EntityBinding[],
  ): OperationCapability {
    const control = this.database
      .prepare("SELECT * FROM internal_control WHERE singleton_id=1")
      .get() as Record<string, unknown> | undefined;
    assert(control !== undefined, "INTERNAL_CONTROL_MISSING");
    const currentPhase = phase(control.phase);
    const ownerProcess = input.ownerProcess ?? this.ownerProcess;
    const egressClass = input.egressClass ?? "none";
    const capabilityClass = input.capabilityClass ?? "db_mutation";
    const policyId =
      input.policyId ??
      this.defaultPolicy(
        input.operationKind,
        currentPhase,
        egressClass,
        ownerProcess,
        capabilityClass,
      );
    const entitySet = providedEntitySet ?? [
      Object.freeze({
        entityKind: (input as GatewayMutationPortInput).entityKind,
        entityId: id(
          (input as GatewayMutationPortInput).entityId,
          "ENTITY_ID_INVALID",
        ),
        identitySelector: this.identitySelector(
          (input as GatewayMutationPortInput).entityKind,
        ),
        expectedVersion:
          (input as GatewayMutationPortInput).expectedVersion ?? null,
        expectedHash: (input as GatewayMutationPortInput).expectedHash ?? ZERO,
      }),
    ];
    assert(entitySet.length > 0, "ENTITY_SET_EMPTY");
    const normalizedEntitySet = entitySet.map((binding) =>
      Object.freeze({
        ...binding,
        entityId: id(binding.entityId, "ENTITY_ID_INVALID"),
        expectedHash: binding.expectedHash ?? ZERO,
      }),
    );
    for (const binding of normalizedEntitySet)
      assert(HASH.test(binding.expectedHash), "EXPECTED_ENTITY_HASH_INVALID");
    const identity = Object.freeze({ ...input.identity });
    const requiredFenceSet =
      input.requiredFenceSet ??
      this.readRequiredFenceSet(policyId, identity, control);
    const operationId = id(input.operationId, "OPERATION_ID_INVALID");
    const requestBody = {
      operationId,
      operationKind: input.operationKind,
      ownerProcess,
      entitySet: normalizedEntitySet,
      identity,
      phase: currentPhase,
      egressClass,
      policyId,
    };
    const requestHash = "requestHashOverride" in input && input.requestHashOverride !== undefined
      ? input.requestHashOverride
      : sha256(`f1plus1-gateway-mutation-v1\n${canonicalJsonV1(requestBody)}`);
    assert(HASH.test(requestHash), "REQUEST_HASH_INVALID");
    const requestFingerprint = sha256(
      `f1plus1-gateway-mutation-fingerprint-v1\n${requestHash}`,
    );
    const handoff = this.handoffProvider();
    const requested = this.gateway.request(handoff, {
        schemaVersion: "operation-request-v1",
        operationId,
        idempotencyKey: "idempotencyKeyOverride" in input && input.idempotencyKeyOverride !== undefined
          ? id(input.idempotencyKeyOverride, "IDEMPOTENCY_KEY_INVALID")
          : `idempotency-${operationId}`,
        operationKind: input.operationKind,
        ownerProcess,
        capabilityClass,
        policyId,
        authorizationHandoffId: handoff.handoffId,
        controlAction: input.controlAction ?? null,
        identity,
        entitySet: normalizedEntitySet,
        requiredFenceSet,
        expected: {
          controlVersion: Number(control.version),
          entityVersion: normalizedEntitySet[0].expectedVersion,
          entityHash: normalizedEntitySet[0].expectedHash,
          schemaSha256: this.gateway.expectedSchemaSha256(),
          releaseSha256: handoff.releaseSha256,
          manifestSha256: handoff.manifestSha256,
          sourceStopEpoch: input.sourceStopEpoch ?? null,
          writerEpoch: Number(control.writer_epoch),
          epochs: {
            sourceConfig: Number(control.source_config_epoch),
            sourceSafety: Number(control.source_safety_epoch),
            authorization: Number(control.authorization_version),
            policy: Number(control.policy_epoch),
            recovery: Number(control.recovery_epoch),
          },
        },
        phase: currentPhase,
        egressClass,
        budgetRequest:
          egressClass === "none"
            ? null
            : {
                reservationId: `reservation-${operationId}`,
                accountId: input.budgetAccountId ?? "gateway-unconfigured",
                units: 1,
              },
        modelRouteRef: input.modelRouteRef ?? null,
        requestHash,
        requestFingerprint,
      });
    return this.gateway.authorize(requested);
  }

  private fenceSetHash(fences: readonly FenceBinding[]): string {
    return sha256(`f1plus1-fence-set-v1\n${canonicalJsonV1(fences)}`);
  }

  private defaultPolicy(
    operationKind: OperationKind,
    currentPhase: Phase,
    egressClass: EgressClass,
    ownerProcess = this.ownerProcess,
    capabilityClass: CapabilityClass = "db_mutation",
  ): string {
    if (operationKind === "review")
      return `p-review-${ownerProcess === "automatic_reviewer" ? "auto" : "admin"}-${currentPhase}`;
    if (operationKind === "publish")
      return `p-publish-${ownerProcess === "automatic_publisher" ? "auto" : "admin"}-${currentPhase}`;
    if (operationKind === "source_update") return "p-source-update-paused";
    if (operationKind === "source_create") return "p-source-create-disabled";
    if (operationKind === "source_delete") return "p-source-delete-paused";
    if (operationKind === "refine")
      return `p-refine-${this.ownerProcess === "bilingual_refiner" ? "bi" : "rss"}-${currentPhase}`;
    if (operationKind === "collect") return `p-collect-${currentPhase}`;
    if (operationKind === "projection")
      return capabilityClass === "db_mutation"
        ? `p-projection-receiver-${currentPhase}`
        : `p-projection-${currentPhase}`;
    throw new Error(`GATEWAY_POLICY_UNMAPPED:${operationKind}:${egressClass}`);
  }

  private identitySelector(
    entityKind: EntityKind,
  ): EntityBinding["identitySelector"] {
    if (entityKind === "source") return "source_id";
    if (entityKind === "candidate") return "candidate_id";
    if (entityKind === "publication" || entityKind === "published_projection")
      return "publication_id";
    if (
      entityKind === "projection_pointer" ||
      entityKind === "internal_control"
    )
      return "control_singleton";
    return "bound_child";
  }

  private readRequiredFenceSet(
    policyId: string,
    identity: Readonly<{
      sourceId: string | null;
      candidateId: string | null;
      publicationId: string | null;
      publicId: string | null;
    }>,
    control: Record<string, unknown>,
  ): readonly FenceBinding[] {
    const now = this.now().toISOString();
    const rows = this.database
      .prepare(
        "SELECT scope_selector,fence_kind,required_state FROM internal_required_fence_policy WHERE policy_id=? ORDER BY scope_selector,fence_kind,required_state",
      )
      .all(policyId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const selector = String(row.scope_selector);
      const scopeKind =
        selector === "global"
          ? "global"
          : selector === "source_id"
            ? "source"
            : selector === "candidate_id"
              ? "candidate"
              : selector === "publication_id"
                ? "publication"
                : (() => {
                    throw new Error("FENCE_POLICY_SELECTOR_INVALID");
                  })();
      const scopeId =
        scopeKind === "global"
          ? null
          : scopeKind === "source"
            ? identity.sourceId
            : scopeKind === "candidate"
              ? identity.candidateId
              : identity.publicationId;
      assert(scopeKind === "global" || scopeId !== null, "FENCE_SCOPE_MISSING");
      const hasAutomaticAuthority = this.database.prepare("SELECT 1 FROM sqlite_schema WHERE name='rss_automatic_fence_current_v1' AND type='view'").get() !== undefined;
      const requireCurrent = hasAutomaticAuthority && (policyId.startsWith("p-review-auto-") || policyId.startsWith("p-publish-auto-") || policyId.startsWith("p-refine-rss-"));
      const requireXCurrent = ["p-x-page-refine-live", "p-x-page-refine-store-live", "p-x-page-auto-review-live", "p-x-page-auto-publish-live"].includes(policyId);
      const currentClause = requireXCurrent
        ? " AND EXISTS(SELECT 1 FROM x_page_automatic_fence_current_v1 v JOIN internal_operation issuer ON issuer.operation_id=v.issued_by_operation_id WHERE v.fence_receipt_id=generic_fence_receipt.fence_receipt_id AND v.candidate_id=? AND v.source_id=? AND issuer.expected_schema_sha256=? AND issuer.expected_release_sha256=? AND issuer.expected_manifest_sha256=?)"
        : requireCurrent
        ? " AND EXISTS(SELECT 1 FROM rss_automatic_fence_current_v1 v JOIN internal_operation issuer ON issuer.operation_id=v.issued_by_operation_id WHERE v.fence_receipt_id=generic_fence_receipt.fence_receipt_id AND v.candidate_id=? AND v.source_id=? AND issuer.expected_schema_sha256=? AND issuer.expected_release_sha256=? AND issuer.expected_manifest_sha256=?)"
        : policyId.startsWith("p-collect-") ? " AND reason_code<>'RSS_AUTOMATIC_CURRENT_V1'" : "";
      const receipt = this.database
        .prepare(
          `SELECT fence_receipt_id,receipt_sha256 FROM generic_fence_receipt WHERE scope_kind=? AND scope_id IS ? AND fence_kind=? AND policy_epoch=? AND recovery_epoch=? AND writer_epoch=? AND state='clear' AND expires_at>?${currentClause} ORDER BY observed_at DESC,fence_receipt_id DESC LIMIT 1`,
        )
        .get(
          ...([
            scopeKind,
            scopeId,
            row.fence_kind,
            Number(control.policy_epoch),
            Number(control.recovery_epoch),
            Number(control.writer_epoch),
            now,
            ...((requireCurrent || requireXCurrent) ? [identity.candidateId, identity.sourceId, this.gateway.expectedSchemaSha256(), this.gateway.expectedReleaseSha256(), this.gateway.expectedManifestSha256()] : []),
          ] as any[]),
        ) as Record<string, unknown> | undefined;
      assert(receipt !== undefined, "GATEWAY_FENCE_MISSING");
      return Object.freeze({
        fenceReceiptId: id(
          receipt.fence_receipt_id,
          "FENCE_RECEIPT_ID_INVALID",
        ),
        receiptSha256: String(receipt.receipt_sha256),
        scopeKind,
        scopeId,
        fenceKind: String(row.fence_kind) as FenceBinding["fenceKind"],
        requiredState: String(
          row.required_state,
        ) as FenceBinding["requiredState"],
      });
    });
  }
}
