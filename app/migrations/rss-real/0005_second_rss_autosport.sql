PRAGMA foreign_keys=OFF;

CREATE TABLE source_v5 (
  source_id TEXT PRIMARY KEY CHECK (source_id IN ('motorsport-f1-news', 'autosport-f1-news')),
  feed_url TEXT NOT NULL UNIQUE CHECK (feed_url IN (
    'https://www.motorsport.com/rss/f1/news/',
    'https://www.autosport.com/rss/f1/news/'
  )),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  stop_epoch INTEGER NOT NULL DEFAULT 1 CHECK (stop_epoch >= 1),
  etag TEXT CHECK (etag IS NULL OR (length(CAST(etag AS BLOB)) <= 1024 AND instr(etag, char(10)) = 0 AND instr(etag, char(13)) = 0)),
  last_modified TEXT CHECK (last_modified IS NULL OR (length(CAST(last_modified AS BLOB)) <= 1024 AND instr(last_modified, char(10)) = 0 AND instr(last_modified, char(13)) = 0)),
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_eligible_at TEXT,
  last_reason_code TEXT NOT NULL DEFAULT 'NEVER_RUN',
  CHECK (
    (source_id = 'motorsport-f1-news' AND feed_url = 'https://www.motorsport.com/rss/f1/news/') OR
    (source_id = 'autosport-f1-news' AND feed_url = 'https://www.autosport.com/rss/f1/news/')
  )
) STRICT;

INSERT INTO source_v5 (
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
)
SELECT
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
FROM source;

DROP TABLE source;
ALTER TABLE source_v5 RENAME TO source;

CREATE TABLE ingest_run_v5 (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  slot_key INTEGER NOT NULL,
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
  UNIQUE (source_id, slot_key),
  CHECK (new_count + updated_count + duplicate_count <= selected_count)
) STRICT;

INSERT INTO ingest_run_v5 (
  run_id, source_id, slot_key, scheduled_at, started_at, finished_at, http_status,
  validator_result, validator_capability, response_sha256, response_bytes, item_count,
  selected_count, new_count, updated_count, duplicate_count, status, reason_code, next_action
)
SELECT
  run_id, source_id, slot_key, scheduled_at, started_at, finished_at, http_status,
  validator_result, validator_capability, response_sha256, response_bytes, item_count,
  selected_count, new_count, updated_count, duplicate_count, status, reason_code, next_action
FROM ingest_run;

DROP TABLE ingest_run;
ALTER TABLE ingest_run_v5 RENAME TO ingest_run;

CREATE INDEX ingest_run_source_slot_idx ON ingest_run(source_id, slot_key DESC);

INSERT INTO source (
  source_id,
  feed_url,
  enabled,
  stop_epoch,
  last_reason_code
) VALUES (
  'autosport-f1-news',
  'https://www.autosport.com/rss/f1/news/',
  1,
  1,
  'NEVER_RUN'
);

PRAGMA foreign_keys=ON;
PRAGMA user_version = 5;
