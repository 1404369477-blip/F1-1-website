export type SiteStatus = "healthy" | "degraded" | "failed" | "unknown";

export type DatabaseReason =
  | "DATABASE_READ_FAILED" | "DATABASE_IDENTITY_MISMATCH" | "DATABASE_SCHEMA_MISMATCH"
  | "DEPLOYMENT_IDENTITY_MISMATCH" | "DATABASE_SAMPLE_LIMIT" | "DATABASE_DATA_INVALID"
  | "CLOCK_INVALID" | "CONTROL_CLOSED" | "RSS_SOURCE_DISABLED" | "RSS_SUCCESS_UNKNOWN"
  | "RSS_SUCCESS_STALE" | "RSS_SLOT_INTERVAL_UNKNOWN" | "RSS_SLOT_INTERVAL_EXCEEDED"
  | "RSS_LATEST_ATTEMPT_FAILED" | "RSS_DRAFT_BACKLOG_AGED" | "RSS_REVIEW_BACKLOG_AGED"
  | "RSS_PUBLICATION_BACKLOG_AGED" | "UNKNOWN_OPERATIONS_PRESENT" | "UNKNOWN_BASELINE_UNAVAILABLE"
  | "UNRESOLVED_OPERATIONS_PRESENT" | "UNRESOLVED_OUTBOX_PRESENT" | "TERMINAL_FAILED_OUTBOX_PRESENT";

export type BackupReason =
  | "BACKUP_DATABASE_UNKNOWN" | "BACKUP_DATABASE_SAMPLE_STALE" | "BACKUP_POINT_MISSING"
  | "BACKUP_POINT_STALE" | "BACKUP_TIME_INVALID" | "BACKUP_EVIDENCE_MISSING"
  | "BACKUP_EVIDENCE_INVALID" | "BACKUP_MANIFEST_MISMATCH" | "BACKUP_KEY_MISMATCH"
  | "BACKUP_OFFHOST_SIGNATURE_INVALID" | "BACKUP_APPLICATION_SIGNATURE_INVALID"
  | "BACKUP_RECEIPT_BINDING_MISMATCH";

/** Operator configuration only. No part of either config is accepted from model arguments. */
export type DatabaseSampleConfig = Readonly<{
  databasePath: string;
  deploymentManifestPath: string;
  expectedDeploymentManifestSha256: string;
  expectedSchemaSha256: string;
  expectedReleaseSha256: string;
  expectedDatabaseIdentity: Readonly<{ device: number; inode: number; uid: number }>;
  busyTimeoutMs?: number;
  unknownBaseline?: Readonly<{ observedAt: string; operationIdSha256: readonly string[] }>;
}>;

export type BackupSampleConfig = Readonly<{
  backupRoot: string;
  backupStateRoot: string;
  offHostPublicKeyPath: string;
  applicationDrillPublicKeyPath: string;
  expectedOffHostPublicKeySha256: string;
  expectedApplicationDrillPublicKeySha256: string;
}>;

export type CountAge = Readonly<{ count: number; oldestAt: string | null; oldestAgeMs: number | null }>;
export type RssSourceSample = Readonly<{
  sourceId: "motorsport-f1-news" | "the-race-f1-news" | "skysports-f1-news";
  status: SiteStatus;
  observedAt: string;
  reasons: readonly DatabaseReason[];
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessAgeMs: number | null;
  latestAttemptStatus: "running" | "succeeded" | "not_modified" | "failed" | "scheduler_gap" | null;
  latestSucceededSlotAt: string | null;
  previousSucceededSlotAt: string | null;
  actualSucceededSlotIntervalMs: number | null;
  latestSucceededScheduledAt: string | null;
  previousSucceededScheduledAt: string | null;
  scheduledSucceededSlotIntervalMs: number | null;
  candidateCounts: Readonly<Record<"pending_review" | "approved" | "published" | "rejected" | "other", number>>;
  backlog: CountAge;
  missingCurrentDraft: CountAge;
  awaitingReview: CountAge;
  queuedPublications: CountAge;
}>;

export type ControlSample = Readonly<{
  status: SiteStatus;
  observedAt: string;
  phase: "disabled" | "backlog" | "live" | "paused";
  globalStopState: "clear" | "stopped";
  emergencyStopState: "clear" | "stopped";
  recoveryState: "ready" | "fenced" | "restoring" | "verifying" | "failed";
  deletionFenceState: "clear" | "blocked" | "unknown";
  publicationFenceState: "clear" | "blocked" | "unknown";
  writerEpoch: number;
  recoveryEpoch: number;
  sourceConfigEpoch: number;
  sourceSafetyEpoch: number;
  authorizationVersion: number;
  policyEpoch: number;
  writerAuthorityReceiptSha256: string;
}>;

export type BackupPointSample = Readonly<{
  packageRef: string;
  recoveryPointAt: string;
  completedAt: string;
  ageMs: number;
  manifestSha256: string;
  databaseSnapshotSha256: string;
  deploymentManifestSha256: string;
  releaseSha256: string;
  schemaSha256: string;
  writerEpoch: number;
  recoveryEpoch: number;
  writerAuthorityReceiptSha256: string;
  projectionGeneration: number;
  projectionManifestSha256: string | null;
}>;

export type DatabaseSample = Readonly<{
  status: SiteStatus;
  observedAt: string;
  reasons: readonly DatabaseReason[];
  identity: Readonly<{ deploymentManifestSha256: string; schemaSha256: string; releaseSha256: string; userVersion: number }> | null;
  control: ControlSample | null;
  rss: Readonly<{
    status: SiteStatus;
    observedAt: string;
    cutoffAt: "2026-09-05T02:30:00.000Z";
    expectedSlotIntervalMs: 900000;
    staleSuccessAfterMs: 900000;
    failedSuccessAfterMs: 1800000;
    sources: readonly RssSourceSample[];
  }> | null;
  pipeline: Readonly<{
    status: SiteStatus;
    observedAt: string;
    unknownOperations: number;
    unknownScope: "recorded_unresolved_operations_all_revisions";
    unknownByOwner: Readonly<Record<"rss_collector" | "rss_refiner" | "projection_sender" | "other", number>>;
    currentRevisionRefinerUnknown: number;
    unknownBaselineAt: string | null;
    existingUnknown: number | null;
    newUnknown: number | null;
    unresolvedOperations: CountAge;
    unresolvedOutbox: CountAge;
    terminalFailedOutbox: number;
  }> | null;
  backupPoint: BackupPointSample | null;
}>;

export type BackupSample = Readonly<{
  status: SiteStatus;
  observedAt: string;
  reasons: readonly BackupReason[];
  databaseObservedAt: string;
  point: BackupPointSample | null;
  maxRecoveryPointAgeMs: 900000;
  manifestVerified: boolean | null;
  offHostSignatureVerified: boolean | null;
  applicationSignatureVerified: boolean | null;
  offHostReadCompletedAt: string | null;
  applicationDrillCompletedAt: string | null;
  verificationScope: "registered-point-and-pinned-signed-receipts";
  offHostCiphertextReread: false;
  restoreExecuted: false;
}>;
