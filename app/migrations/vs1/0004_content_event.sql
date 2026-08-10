CREATE TABLE content (
  content_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES source(source_id),
  capture_id TEXT REFERENCES captured_item(capture_id),
  external_content_id TEXT NOT NULL,
  content_version_hash TEXT NOT NULL CHECK (length(content_version_hash) = 64),
  content_status TEXT NOT NULL CHECK (content_status IN ('captured','normalized','dedup_pending','review_pending','approved','rejected','publish_queued','published','failed')),
  event_input_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(platform, source_id, external_content_id, content_version_hash)
);

CREATE TABLE event (
  event_id TEXT PRIMARY KEY,
  dedup_fingerprint TEXT NOT NULL UNIQUE CHECK (length(dedup_fingerprint) = 64),
  canonical_content_id TEXT NOT NULL REFERENCES content(content_id),
  member_content_ids_json TEXT NOT NULL,
  dedup_status TEXT NOT NULL CHECK (dedup_status IN ('pending','canonical','merged','needs_review')),
  source_config_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_ref TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
