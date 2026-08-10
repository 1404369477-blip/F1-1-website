CREATE TABLE fixture_profile_ledger (
  profile_id TEXT PRIMARY KEY CHECK (profile_id = 'source-management-synthetic'),
  sqlite_path TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  baseline_file_sha256 TEXT NOT NULL CHECK (length(baseline_file_sha256) = 64),
  baseline_projection_sha256 TEXT NOT NULL CHECK (length(baseline_projection_sha256) = 64),
  baseline_row_count INTEGER NOT NULL CHECK (baseline_row_count = 59),
  source_field_count INTEGER NOT NULL CHECK (source_field_count = 39),
  baseline_enabled_false_count INTEGER NOT NULL CHECK (baseline_enabled_false_count = 59),
  source_schema_sha256 TEXT NOT NULL CHECK (length(source_schema_sha256) = 64),
  migration_selector_root_sha256 TEXT NOT NULL CHECK (length(migration_selector_root_sha256) = 64),
  schema_fingerprint_sha256 TEXT NOT NULL CHECK (length(schema_fingerprint_sha256) = 64),
  validator_sha256 TEXT NOT NULL CHECK (length(validator_sha256) = 64),
  row_count_contract_json TEXT NOT NULL,
  synthetic_only INTEGER NOT NULL CHECK (synthetic_only = 1),
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  writes_to_base INTEGER NOT NULL CHECK (writes_to_base = 0),
  real_content_imported INTEGER NOT NULL CHECK (real_content_imported = 0),
  recorded_at TEXT NOT NULL
);

CREATE TABLE source_overlay_lineage (
  source_id TEXT PRIMARY KEY REFERENCES source_config_fixture(source_id),
  origin TEXT NOT NULL CHECK (origin = 'local_synthetic'),
  baseline_projection_hash TEXT NOT NULL CHECK (length(baseline_projection_hash) = 64),
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  effective_source_hash TEXT NOT NULL UNIQUE CHECK (length(effective_source_hash) = 64),
  full_identity_hash TEXT NOT NULL CHECK (length(full_identity_hash) = 64),
  first_operation_id TEXT NOT NULL UNIQUE,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_runtime_fence (
  source_id TEXT PRIMARY KEY REFERENCES source_config_fixture(source_id),
  authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
  policy_epoch INTEGER NOT NULL CHECK (policy_epoch >= 1),
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 1),
  updated_at TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL
);

CREATE TABLE operation_receipt (
  command_operation_id TEXT PRIMARY KEY,
  command_idempotency_key TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL CHECK (method = 'POST'),
  exact_path TEXT NOT NULL,
  canonical_body_hash TEXT NOT NULL CHECK (length(canonical_body_hash) = 64),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('source_add','source_validate','source_activate','source_stop','source_retire','source_requeue')),
  source_id TEXT NOT NULL,
  expected_source_hash TEXT,
  expected_source_version INTEGER,
  expected_source_config_epoch INTEGER,
  expected_source_safety_epoch INTEGER,
  expected_authorization_version INTEGER,
  expected_policy_epoch INTEGER,
  expected_recovery_epoch INTEGER,
  operation_status TEXT NOT NULL CHECK (operation_status IN ('pending','succeeded','failed')),
  business_operation_id TEXT,
  business_idempotency_key TEXT,
  outbox_job_id TEXT,
  result_hash TEXT,
  reason_code TEXT,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX operation_receipt_source_idx
  ON operation_receipt(source_id, created_at, command_operation_id);

CREATE TABLE outbox_job (
  job_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  task_envelope TEXT NOT NULL,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  business_operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type = 'source_activation'),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'source'),
  aggregate_id TEXT NOT NULL REFERENCES source_config_fixture(source_id),
  business_idempotency_key TEXT NOT NULL UNIQUE,
  reconcile_key TEXT NOT NULL UNIQUE,
  source_config_epoch INTEGER NOT NULL CHECK (source_config_epoch >= 1),
  source_safety_epoch INTEGER NOT NULL CHECK (source_safety_epoch >= 1),
  authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
  policy_epoch INTEGER NOT NULL CHECK (policy_epoch >= 1),
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 1),
  lease_token TEXT NOT NULL,
  lease_expiry TEXT,
  deadline TEXT NOT NULL,
  job_status TEXT NOT NULL CHECK (job_status IN ('pending','leased','succeeded','retryable_failed','terminal_failed','cancelled','stale_epoch','dead_letter')),
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 3),
  retry_generation INTEGER NOT NULL CHECK (retry_generation >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts = 3),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  last_error_code TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_ref TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL,
  UNIQUE(business_operation_id, operation_type)
);

CREATE INDEX source_management_outbox_due_idx
  ON outbox_job(job_status, next_attempt_at, job_id);

CREATE TABLE inbox (
  inbox_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES outbox_job(job_id),
  task_envelope TEXT NOT NULL,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  business_operation_id TEXT NOT NULL,
  business_idempotency_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  inbox_status TEXT NOT NULL CHECK (inbox_status IN ('received','processing','acked','rejected')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(business_operation_id, business_idempotency_key),
  UNIQUE(envelope_hash)
);

CREATE TABLE task_attempt (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES outbox_job(job_id),
  retry_generation INTEGER NOT NULL CHECK (retry_generation >= 0),
  attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
  lease_token TEXT NOT NULL UNIQUE,
  lease_expiry TEXT NOT NULL,
  deadline TEXT NOT NULL,
  worker_ref TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  attempt_status TEXT NOT NULL CHECK (attempt_status IN ('leased','succeeded','retryable_failed','terminal_failed','stale_epoch','cancelled')),
  error_code TEXT,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  UNIQUE(job_id, retry_generation, attempt_no)
);

CREATE INDEX source_management_attempt_lease_idx
  ON task_attempt(attempt_status, lease_expiry);

CREATE TABLE dead_letter (
  dead_letter_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES outbox_job(job_id),
  retry_generation INTEGER NOT NULL CHECK (retry_generation >= 0),
  business_operation_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  recorded_at TEXT NOT NULL,
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  UNIQUE(job_id, retry_generation)
);

CREATE TABLE audit_event (
  event_id TEXT PRIMARY KEY,
  monotonic_seq INTEGER NOT NULL UNIQUE CHECK (monotonic_seq >= 1),
  occurred_at TEXT NOT NULL,
  clock_status TEXT NOT NULL CHECK (clock_status = 'trusted_local_clock'),
  trace_ref TEXT NOT NULL,
  session_hash TEXT,
  reason_code TEXT NOT NULL,
  owner TEXT NOT NULL,
  operation_id TEXT,
  task_id TEXT,
  source_config_epoch INTEGER NOT NULL CHECK (source_config_epoch >= 1),
  source_safety_epoch INTEGER NOT NULL CHECK (source_safety_epoch >= 1),
  authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
  policy_epoch INTEGER NOT NULL CHECK (policy_epoch >= 1),
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 1),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  fixture_hash TEXT NOT NULL CHECK (length(fixture_hash) = 64),
  schema_hash TEXT NOT NULL CHECK (length(schema_hash) = 64),
  redaction_version TEXT NOT NULL,
  retention TEXT NOT NULL,
  cleanup_after TEXT NOT NULL,
  append_only INTEGER NOT NULL CHECK (append_only = 1),
  internal_only INTEGER NOT NULL CHECK (internal_only = 1),
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  payload_json TEXT NOT NULL
);

CREATE TRIGGER source_management_audit_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER source_management_audit_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;
