CREATE TABLE source (
  source_id TEXT PRIMARY KEY CHECK (source_id = 'motorsport-f1-news'),
  feed_url TEXT NOT NULL UNIQUE CHECK (feed_url = 'https://www.motorsport.com/rss/f1/news/'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  stop_epoch INTEGER NOT NULL DEFAULT 1 CHECK (stop_epoch >= 1),
  etag TEXT CHECK (etag IS NULL OR (length(CAST(etag AS BLOB)) <= 1024 AND instr(etag, char(10)) = 0 AND instr(etag, char(13)) = 0)),
  last_modified TEXT CHECK (last_modified IS NULL OR (length(CAST(last_modified AS BLOB)) <= 1024 AND instr(last_modified, char(10)) = 0 AND instr(last_modified, char(13)) = 0)),
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_eligible_at TEXT,
  last_reason_code TEXT NOT NULL DEFAULT 'NEVER_RUN'
) STRICT;

CREATE TABLE ingest_run (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  slot_key INTEGER NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  http_status INTEGER CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
  validator_result TEXT NOT NULL CHECK (validator_result IN ('unknown', 'modified', 'not_modified')),
  validator_capability TEXT NOT NULL CHECK (validator_capability IN ('unknown', 'supported')),
  response_sha256 TEXT CHECK (response_sha256 IS NULL OR (length(response_sha256) = 64 AND response_sha256 NOT GLOB '*[^0-9a-f]*')),
  response_bytes INTEGER NOT NULL DEFAULT 0 CHECK (response_bytes >= 0 AND response_bytes <= 1048576),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0 AND item_count <= 60),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0 AND selected_count <= 20 AND selected_count <= item_count),
  new_count INTEGER NOT NULL DEFAULT 0 CHECK (new_count >= 0 AND new_count <= selected_count),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0 AND updated_count <= selected_count),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0 AND duplicate_count <= selected_count),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'not_modified', 'failed', 'scheduler_gap')),
  reason_code TEXT NOT NULL,
  next_action TEXT NOT NULL CHECK (next_action IN ('none', 'next_slot', 'manual_review')),
  CHECK (new_count + updated_count + duplicate_count <= selected_count)
) STRICT;

CREATE INDEX ingest_run_source_slot_idx ON ingest_run(source_id, slot_key DESC);

CREATE TABLE pending_review_candidate (
  candidate_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK (length(CAST(external_id AS BLOB)) BETWEEN 1 AND 16384),
  dedupe_key TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) = 64 AND dedupe_key NOT GLOB '*[^0-9a-f]*'),
  canonical_url TEXT NOT NULL CHECK (length(CAST(canonical_url AS BLOB)) BETWEEN 1 AND 16384 AND canonical_url LIKE 'https://%'),
  title TEXT NOT NULL CHECK (length(CAST(title AS BLOB)) BETWEEN 1 AND 16384),
  excerpt TEXT NOT NULL CHECK (length(CAST(excerpt AS BLOB)) <= 16384),
  author TEXT CHECK (author IS NULL OR length(CAST(author AS BLOB)) <= 16384),
  published_at TEXT NOT NULL,
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  editor_title TEXT,
  editor_excerpt TEXT,
  editor_notes TEXT,
  editor_based_on_source_revision INTEGER CHECK (editor_based_on_source_revision IS NULL OR editor_based_on_source_revision >= 1),
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (length(review_status) BETWEEN 1 AND 64),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source_id, external_id),
  CHECK (editor_based_on_source_revision IS NULL OR editor_based_on_source_revision <= source_revision)
) STRICT;

CREATE INDEX pending_review_candidate_published_idx
  ON pending_review_candidate(published_at DESC, external_id ASC);

INSERT INTO source (
  source_id,
  feed_url,
  enabled,
  stop_epoch,
  last_reason_code
) VALUES (
  'motorsport-f1-news',
  'https://www.motorsport.com/rss/f1/news/',
  1,
  1,
  'NEVER_RUN'
);

PRAGMA user_version = 1;
