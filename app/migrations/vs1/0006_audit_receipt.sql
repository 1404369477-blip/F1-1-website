CREATE TABLE audit_event (
  event_id TEXT PRIMARY KEY,
  monotonic_seq INTEGER NOT NULL UNIQUE CHECK (monotonic_seq >= 1),
  reason_code TEXT NOT NULL,
  operation_id TEXT,
  task_id TEXT,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  fixture_hash TEXT NOT NULL CHECK (length(fixture_hash) = 64),
  schema_hash TEXT NOT NULL CHECK (length(schema_hash) = 64),
  append_only INTEGER NOT NULL CHECK (append_only = 1),
  internal_only INTEGER NOT NULL CHECK (internal_only = 1),
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  payload_json TEXT NOT NULL
);

CREATE TABLE operation_receipt (
  operation_id TEXT PRIMARY KEY,
  reason_code TEXT NOT NULL,
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
  receipt_json TEXT NOT NULL,
  artifact_hash TEXT
);
