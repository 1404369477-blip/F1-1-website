CREATE TABLE migration_ledger (
  migration_id TEXT PRIMARY KEY,
  migration_sha256 TEXT NOT NULL CHECK (length(migration_sha256) = 64),
  applied_at TEXT NOT NULL,
  append_only INTEGER NOT NULL CHECK (append_only = 1)
);

CREATE TABLE source (
  source_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  collection_onboarding_status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  source_stop_status TEXT NOT NULL,
  adapter_status TEXT NOT NULL,
  adapter_authorization_status TEXT NOT NULL,
  platform_allowed TEXT NOT NULL,
  source_config_epoch INTEGER NOT NULL CHECK (source_config_epoch >= 1),
  source_safety_epoch INTEGER NOT NULL CHECK (source_safety_epoch >= 1),
  onboarding_operation_id TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE outbox_job (
  job_id TEXT PRIMARY KEY,
  task_envelope TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type = 'source_activation'),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'source'),
  aggregate_id TEXT NOT NULL REFERENCES source(source_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  reconcile_key TEXT,
  current_source_config_epoch INTEGER NOT NULL,
  authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
  policy_epoch INTEGER NOT NULL CHECK (policy_epoch >= 1),
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 1),
  job_status TEXT NOT NULL CHECK (job_status IN ('pending','leased','succeeded','retryable_failed','terminal_failed','cancelled','stale_epoch','dead_letter')),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts = 3),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  last_error_code TEXT,
  next_attempt_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_ref TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL,
  UNIQUE(operation_id, operation_type)
);

CREATE INDEX outbox_due_idx ON outbox_job(job_status, next_attempt_at, job_id);
