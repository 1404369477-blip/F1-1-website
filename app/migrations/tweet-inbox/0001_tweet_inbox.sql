CREATE TABLE inbox_item (
  tweet_id TEXT PRIMARY KEY CHECK (
    length(tweet_id) BETWEEN 1 AND 19
    AND tweet_id NOT GLOB '*[^0-9]*'
  ),
  submitted_url TEXT NOT NULL CHECK (length(CAST(submitted_url AS BLOB)) BETWEEN 1 AND 2048),
  canonical_url TEXT CHECK (canonical_url IS NULL OR (
    length(CAST(canonical_url AS BLOB)) BETWEEN 1 AND 2048
    AND canonical_url LIKE 'https://x.com/%/status/%'
  )),
  handle TEXT CHECK (handle IS NULL OR (
    length(handle) BETWEEN 1 AND 15
    AND handle NOT GLOB '*[^A-Za-z0-9_]*'
  )),
  author_name TEXT CHECK (author_name IS NULL OR length(CAST(author_name AS BLOB)) BETWEEN 1 AND 256),
  tweet_text TEXT CHECK (tweet_text IS NULL OR length(CAST(tweet_text AS BLOB)) <= 4096),
  source_published_at TEXT,
  oembed_sha256 TEXT CHECK (oembed_sha256 IS NULL OR (
    length(oembed_sha256) = 64
    AND oembed_sha256 NOT GLOB '*[^0-9a-f]*'
  )),
  status TEXT NOT NULL CHECK (status IN ('queued', 'fetched', 'rejected', 'failed')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  first_seen_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  fetched_at TEXT
) STRICT;

CREATE INDEX inbox_item_status_idx ON inbox_item(status, first_seen_at);

CREATE TABLE inbox_run (
  run_id TEXT PRIMARY KEY,
  slot_key INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  drop_line_count INTEGER NOT NULL DEFAULT 0 CHECK (drop_line_count >= 0 AND drop_line_count <= 200),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  external_calls INTEGER NOT NULL DEFAULT 0 CHECK (external_calls >= 0 AND external_calls <= 20),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'idle', 'failed')),
  reason_code TEXT NOT NULL,
  next_action TEXT NOT NULL CHECK (next_action IN ('none', 'next_slot', 'manual_review'))
) STRICT;

PRAGMA user_version = 1;
