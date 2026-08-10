import type { SourceRow } from "../providers/source-fixture.ts";

export const ADMIN_REASON_CODES = [
  "ADMIN_BIND_CONFIG_DENIED",
  "ADMIN_PEER_DENIED",
  "ADMIN_HOST_DENIED",
  "ADMIN_PROXY_HEADER_DENIED",
  "ADMIN_ORIGIN_REQUIRED",
  "ADMIN_ORIGIN_DENIED",
  "ADMIN_NO_EGRESS_REQUIRED",
  "ADMIN_SESSION_REQUIRED",
  "ADMIN_SESSION_ALREADY_ACTIVE",
  "ADMIN_SESSION_EXPIRED",
  "ADMIN_CLOCK_INVALID",
  "ADMIN_CSRF_CAPACITY",
  "ADMIN_CSRF_INVALID",
  "ADMIN_CSRF_REPLAY",
  "ADMIN_CSRF_EXPIRED",
  "ADMIN_CSRF_BINDING_MISMATCH",
  "ADMIN_COMMAND_IDENTITY_INVALID",
  "ADMIN_COMMAND_IDENTITY_CONFLICT",
  "ADMIN_BUSINESS_IDENTITY_GENERATION_FAILED",
  "ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE",
  "ADMIN_LEASE_IDENTITY_GENERATION_FAILED",
  "ADMIN_SOURCE_ALREADY_PROPOSED",
  "ADMIN_SOURCE_ID_COLLISION",
  "ADMIN_SOURCE_CANONICAL_CONFLICT",
  "ADMIN_SOURCE_NOT_FOUND",
  "ADMIN_M3_SHADOW_DENIED",
  "ADMIN_SOURCE_CURSOR_STALE",
  "ADMIN_SOURCE_STALE",
  "ADMIN_SOURCE_STATE_CONFLICT",
  "ADMIN_SOURCE_GATE_BLOCKED",
  "ADMIN_REQUEUE_CONFLICT",
  "ADMIN_ROUTE_NOT_FOUND",
  "ADMIN_METHOD_DENIED",
  "ADMIN_CONTENT_TYPE_DENIED",
  "ADMIN_BODY_TOO_LARGE",
  "ADMIN_BODY_INVALID",
  "ADMIN_PROFILE_NOT_READY",
  "ADMIN_STORAGE_BUSY",
  "ADMIN_INTERNAL_FAILURE"
] as const;

export type AdminReasonCode = (typeof ADMIN_REASON_CODES)[number];

export class AdminError extends Error {
  readonly reasonCode: AdminReasonCode;
  readonly status: number;

  constructor(reasonCode: AdminReasonCode, status: number) {
    super(reasonCode);
    this.name = "AdminError";
    this.reasonCode = reasonCode;
    this.status = status;
  }
}

export type CommandIdentity = Readonly<{
  command_operation_id: string;
  command_idempotency_key: string;
}>;

export type RuntimeFences = Readonly<{
  authorization_version: number;
  policy_epoch: number;
  recovery_epoch: number;
}>;

export type SourceExpected = Readonly<{
  source_id: string;
  updated_at: string;
  source_config_epoch: number;
  source_safety_epoch: number;
  collection_onboarding_status: string;
  lifecycle_status: string;
  enabled: boolean;
  source_hash: string;
  source_version: number;
}>;

export type SourceReadMeta = Readonly<{
  sourceHash: string;
  sourceVersion: number;
  origin: "m3_baseline" | "local_synthetic";
  baselineRowHash: string | null;
  lastCollectedAt: string | null;
  lastCollectedState: "known" | "unknown";
  allowedActions: readonly string[];
  authorizationVersion: number | null;
  policyEpoch: number | null;
  recoveryEpoch: number | null;
}>;

export type SourceReadItem = Readonly<{ source: SourceRow; meta: SourceReadMeta }>;

export type SourceOperationReceipt = Readonly<{
  schema_version: "admin-source-operation-v0.2";
  command_operation_id: string;
  operation_type: "source_add" | "source_validate" | "source_activate" | "source_stop" | "source_retire" | "source_requeue";
  operation_status: "pending" | "succeeded" | "failed";
  source_id: string;
  business_operation_id?: string;
  outbox_job_id?: string;
  result: Readonly<{
    collection_onboarding_status?: string;
    lifecycle_status?: string;
    enabled?: boolean;
    source_config_epoch?: number;
    source_safety_epoch?: number;
    onboarding_operation_id?: string | null;
  }>;
  reason_code?: AdminReasonCode;
  updated_at: string;
}>;

export type AdminHttpResult = Readonly<{
  status: number;
  headers?: Readonly<Record<string, string | readonly string[]>>;
  body?: unknown;
}>;
