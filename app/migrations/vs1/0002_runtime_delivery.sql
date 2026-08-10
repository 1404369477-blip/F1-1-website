CREATE TABLE inbox (
  inbox_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES outbox_job(job_id),
  task_envelope TEXT NOT NULL,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  inbox_status TEXT NOT NULL CHECK (inbox_status IN ('received','processing','acked','rejected')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_id, idempotency_key),
  UNIQUE(envelope_hash)
);

CREATE TABLE task_attempt (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES outbox_job(job_id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
  lease_token TEXT NOT NULL CHECK (lease_token GLOB 'synthetic:lease:*'),
  lease_expiry TEXT NOT NULL,
  deadline TEXT NOT NULL,
  worker_ref TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  attempt_status TEXT NOT NULL CHECK (attempt_status IN ('leased','succeeded','retryable_failed','terminal_failed','stale_epoch','cancelled')),
  error_code TEXT,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  UNIQUE(job_id, attempt_no)
);

CREATE TABLE dead_letter (
  dead_letter_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES outbox_job(job_id),
  operation_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt = 3 OR reason_code NOT IN ('HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504','COLLECTION_TIMEOUT','DB_LOCK_CONTENTION')),
  recorded_at TEXT NOT NULL,
  external_calls INTEGER NOT NULL CHECK (external_calls = 0)
);
