CREATE TABLE source_observation (
  observation_id TEXT PRIMARY KEY,
  unique_key TEXT NOT NULL UNIQUE,
  owner_ref TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES source(source_id),
  external_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  published_at TEXT,
  cursor_ref TEXT NOT NULL,
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 64),
  error_class TEXT NOT NULL,
  source_config_epoch INTEGER NOT NULL,
  source_safety_epoch INTEGER NOT NULL,
  operation_id TEXT,
  idempotency_key TEXT,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  internal_only INTEGER NOT NULL CHECK (internal_only = 1),
  payload_json TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);

CREATE TABLE captured_item (
  capture_id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES source(source_id),
  external_content_id TEXT NOT NULL,
  normalization_status TEXT NOT NULL CHECK (normalization_status IN ('pending','valid','invalid','needs_review')),
  dedup_status TEXT NOT NULL CHECK (dedup_status IN ('pending','unique','linked_existing','needs_review')),
  content_id TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(source_id, external_content_id)
);
