import { createHash, type KeyObject } from "node:crypto";
import { requestProjectionJson as requestJson } from "./projection-http-transport.ts";

import {
  ProjectionReceiptSchema,
  signProjectionTaskEnvelope,
  type SignedProjectionPackage,
} from "./projection.ts";
import {
  ReviewRealRepository,
  type ProjectionDeliveryWork,
} from "./repository.ts";
import type {
  RssExternalAttemptRunner,
  RssExternalReconcileRunner,
} from "../rss/transport.ts";

export type ProjectionTransportResult =
  | Readonly<{ kind: "response"; status: number; body: unknown }>
  | Readonly<{ kind: "unknown" }>;

export interface ProjectionSenderTransport {
  post(
    packageValue: SignedProjectionPackage,
  ): Promise<ProjectionTransportResult>;
  getReceipt(deliveryId: string): Promise<ProjectionTransportResult>;
}

const INTERNAL_ENDPOINT = "http://127.0.0.1:3102/internal/projections";


export class ProjectionHttpTransport implements ProjectionSenderTransport {
  private readonly serviceIdentity: string;
  private readonly timeoutMs: number;

  constructor(
    input: Readonly<{
      endpoint: typeof INTERNAL_ENDPOINT;
      serviceIdentity: string;
      timeoutMs?: number;
    }>,
  ) {
    if (
      input.endpoint !== INTERNAL_ENDPOINT ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.serviceIdentity)
    ) {
      throw new Error("PROJECTION_TRANSPORT_CONFIG_INVALID");
    }
    this.serviceIdentity = input.serviceIdentity;
    this.timeoutMs = input.timeoutMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1_000 ||
      this.timeoutMs > 30_000
    ) {
      throw new Error("PROJECTION_TRANSPORT_CONFIG_INVALID");
    }
  }

  post(
    packageValue: SignedProjectionPackage,
  ): Promise<ProjectionTransportResult> {
    return requestJson({
      method: "POST",
      path: "/internal/projections",
      body: packageValue,
      serviceIdentity: this.serviceIdentity,
      timeoutMs: this.timeoutMs,
    });
  }

  getReceipt(deliveryId: string): Promise<ProjectionTransportResult> {
    if (!/^op-snapshot-[0-9a-f]{64}$/.test(deliveryId)) {
      return Promise.resolve({ kind: "response", status: 404, body: null });
    }
    return requestJson({
      method: "GET",
      path: `/internal/projections/receipts/${deliveryId}`,
      serviceIdentity: this.serviceIdentity,
      timeoutMs: this.timeoutMs,
    });
  }
}

export type ProjectionSenderTickResult = Readonly<{
  outcome:
    | "idle"
    | "busy"
    | "succeeded"
    | "reconcile_wait"
    | "retryable_failed"
    | "terminal_failed";
  deliveryId: string | null;
}>;

function exactReceipt(
  work: ProjectionDeliveryWork,
  body: unknown,
): unknown | null {
  const parsed = ProjectionReceiptSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.deliveryId !== work.deliveryId ||
    parsed.data.snapshotGeneration !==
      work.envelope.snapshot.snapshotGeneration ||
    parsed.data.snapshotManifestHash !==
      work.envelope.snapshot.snapshotManifestHash
  ) {
    return null;
  }
  return parsed.data;
}

export class ProjectionSender {
  private readonly repository: ReviewRealRepository;
  private readonly transport: ProjectionSenderTransport;
  private readonly signingKeyId: string;
  private readonly privateKey: KeyObject;
  private readonly actorRef: string;
  private readonly externalAttempt: RssExternalAttemptRunner | undefined;
  private readonly externalReconcile: RssExternalReconcileRunner | undefined;
  private readonly prepareDeliveryAuthority: (() => void) | undefined;
  private running = false;

  constructor(
    input: Readonly<{
      repository: ReviewRealRepository;
      transport: ProjectionSenderTransport;
      signingKeyId: string;
      privateKey: KeyObject;
      actorRef: string;
      externalAttempt?: RssExternalAttemptRunner;
      externalReconcile?: RssExternalReconcileRunner;
      prepareDeliveryAuthority?: () => void;
    }>,
  ) {
    this.repository = input.repository;
    this.transport = input.transport;
    this.signingKeyId = input.signingKeyId;
    this.privateKey = input.privateKey;
    this.actorRef = input.actorRef;
    this.externalAttempt = input.externalAttempt;
    this.externalReconcile = input.externalReconcile;
    this.prepareDeliveryAuthority = input.prepareDeliveryAuthority;
  }

  async tick(): Promise<ProjectionSenderTickResult> {
    if (this.running) return { outcome: "busy", deliveryId: null };
    if (
      this.repository.requiresGatewayExternalAttempt() &&
      this.externalAttempt === undefined
    ) {
      throw new Error("GATEWAY_EXTERNAL_ATTEMPT_PORT_REQUIRED");
    }
    this.running = true;
    try {
      this.prepareDeliveryAuthority?.();
      this.repository.recoverExpiredLease(this.actorRef);
      const reconcile = this.repository.nextReconcile();
      if (reconcile !== null) return await this.reconcile(reconcile);
      const leased = this.repository.leaseNext(this.actorRef);
      if (leased === null) return { outcome: "idle", deliveryId: null };
      return await this.deliver(leased);
    } finally {
      this.running = false;
    }
  }

  private async deliver(
    work: ProjectionDeliveryWork,
  ): Promise<ProjectionSenderTickResult> {
    const packageValue = signProjectionTaskEnvelope({
      envelopeJson: work.envelopeJson,
      envelopeHash: work.envelopeHash,
      signingKeyId: this.signingKeyId,
      privateKey: this.privateKey,
    });
    const identity = this.repository.projectionDeliveryIdentity(
      work.deliveryId,
    );
    let result: ProjectionTransportResult;
    try {
      result = this.externalAttempt
        ? await this.externalAttempt({
            operationId: `projection-delivery-${work.deliveryId}-${work.attemptCount}`,
            operationKind: "projection",
            ownerProcess: "projection_sender",
            endpointClass: "projection_deliver",
            providerResource: "127.0.0.1:3102/internal/projections",
            routeId: "route-projection",
            budgetAccountId: "acct-projection",
            method: "POST",
            externalIdempotencyKey: work.envelope.idempotencyKey,
            reconcileKey: work.envelope.reconcileKey,
            bodySha256: createHash("sha256")
              .update(JSON.stringify(packageValue), "utf8")
              .digest("hex"),
            identity,
            entityKind: "projection_outbox",
            entityId: work.deliveryId,
            egressClass: "projection_private",
            execute: async () => {
              const value = await this.transport.post(packageValue);
              if (value.kind === "unknown")
                throw new Error("PROJECTION_RESPONSE_UNKNOWN");
              const body = JSON.stringify(value.body);
              return {
                value,
                response: {
                  providerResourceIdentity:
                    "127.0.0.1:3102/internal/projections",
                  providerStatus: String(value.status),
                  responseBodySha256: createHash("sha256")
                    .update(body, "utf8")
                    .digest("hex"),
                  responseHeaderHashes: [],
                  outcome:
                    value.status >= 200 && value.status < 500
                      ? ("succeeded" as const)
                      : ("known_failed" as const),
                  reasonCode:
                    value.status >= 200 && value.status < 500
                      ? null
                      : "PROJECTION_HTTP_STATUS",
                },
              };
            },
          })
        : await this.transport.post(packageValue);
    } catch {
      result = { kind: "unknown" };
    }
    if (result.kind === "unknown") {
      this.repository.markDeliveryReconcileWait(
        work,
        "DELIVERY_RESPONSE_UNKNOWN",
        this.actorRef,
      );
      return { outcome: "reconcile_wait", deliveryId: work.deliveryId };
    }
    if (result.status >= 200 && result.status <= 299) {
      const receipt = exactReceipt(work, result.body);
      if (receipt === null) {
        this.repository.markDeliveryTerminal(
          work,
          "DELIVERY_RECEIPT_MISMATCH",
          this.actorRef,
        );
        return { outcome: "terminal_failed", deliveryId: work.deliveryId };
      }
      this.repository.markDeliverySucceeded(work, receipt, this.actorRef);
      return { outcome: "succeeded", deliveryId: work.deliveryId };
    }
    if (result.status >= 500 && result.status <= 599) {
      const outcome = this.repository.markDeliveryRetryable(
        work,
        "DELIVERY_HTTP_5XX",
        this.actorRef,
      );
      return { outcome, deliveryId: work.deliveryId };
    }
    this.repository.markDeliveryTerminal(
      work,
      result.status === 409
        ? "DELIVERY_SEMANTIC_CONFLICT"
        : "DELIVERY_REQUEST_REJECTED",
      this.actorRef,
    );
    return { outcome: "terminal_failed", deliveryId: work.deliveryId };
  }

  private async readDeliveryReceipt(
    work: ProjectionDeliveryWork,
  ): Promise<ProjectionTransportResult> {
    if (this.externalReconcile) {
      // Authorization and attempt-handle failures must leave this delivery
      // unresolved; an unguarded GET would bypass the reconciliation gate.
      return await this.externalReconcile({
        reconcileKey: work.envelope.reconcileKey,
        execute: async () => {
          const value = await this.transport.getReceipt(work.deliveryId);
          if (value.kind === "unknown")
            throw new Error("PROJECTION_RECONCILE_UNKNOWN");
          const body = JSON.stringify(value.body);
          return {
            value,
            response: {
              providerResourceIdentity:
                "127.0.0.1:3102/internal/projections",
              providerStatus: String(value.status),
              responseBodySha256: createHash("sha256")
                .update(body, "utf8")
                .digest("hex"),
              responseHeaderHashes: [],
              outcome:
                value.status >= 200 && value.status < 500
                  ? ("succeeded" as const)
                  : ("known_failed" as const),
              reasonCode:
                value.status >= 200 && value.status < 500
                  ? null
                  : "PROJECTION_HTTP_STATUS",
            },
          };
        },
      });
    }
    if (this.externalAttempt) throw new Error("EXTERNAL_RECONCILE_HANDLE_UNAVAILABLE");
    return await this.transport.getReceipt(work.deliveryId);
  }

  private async reconcile(
    work: ProjectionDeliveryWork,
  ): Promise<ProjectionSenderTickResult> {
    let result: ProjectionTransportResult;
    try {
      result = await this.readDeliveryReceipt(work);
    } catch (error) {
      if (
        error instanceof Error &&
        /^PROJECTION_RECONCILE_[A-Z0-9_]{1,96}$/.test(error.message) &&
        error.message !== "PROJECTION_RECONCILE_BACKOFF"
      ) {
        this.repository.markDeliveryReconcileWait(work, error.message, this.actorRef);
      }
      result = { kind: "unknown" };
    }
    if (
      result.kind === "unknown" ||
      (result.status >= 500 && result.status <= 599)
    ) {
      return { outcome: "reconcile_wait", deliveryId: work.deliveryId };
    }
    if (result.status === 404) {
      const outcome = this.repository.markDeliveryRetryable(
        work,
        "PROJECTION_RECEIPT_UNKNOWN",
        this.actorRef,
      );
      return { outcome, deliveryId: work.deliveryId };
    }
    if (result.status >= 200 && result.status <= 299) {
      const receipt = exactReceipt(work, result.body);
      if (receipt === null) {
        this.repository.markDeliveryTerminal(
          work,
          "DELIVERY_RECEIPT_MISMATCH",
          this.actorRef,
        );
        return { outcome: "terminal_failed", deliveryId: work.deliveryId };
      }
      this.repository.markDeliverySucceeded(work, receipt, this.actorRef);
      return { outcome: "succeeded", deliveryId: work.deliveryId };
    }
    this.repository.markDeliveryTerminal(
      work,
      "DELIVERY_SEMANTIC_CONFLICT",
      this.actorRef,
    );
    return { outcome: "terminal_failed", deliveryId: work.deliveryId };
  }
}
