PRAGMA foreign_keys=OFF;

CREATE TABLE source_v6 (
  source_id TEXT PRIMARY KEY CHECK (source_id IN (
    'motorsport-f1-news',
    'autosport-f1-news',
    'racefans-f1-news',
    'the-race-f1-news'
  )),
  feed_url TEXT NOT NULL UNIQUE CHECK (feed_url IN (
    'https://www.motorsport.com/rss/f1/news/',
    'https://www.autosport.com/rss/f1/news/',
    'https://www.racefans.net/category/formula-1/feed/',
    'https://www.the-race.com/category/formula-1/rss/'
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
    (source_id = 'autosport-f1-news' AND feed_url = 'https://www.autosport.com/rss/f1/news/') OR
    (source_id = 'racefans-f1-news' AND feed_url = 'https://www.racefans.net/category/formula-1/feed/') OR
    (source_id = 'the-race-f1-news' AND feed_url = 'https://www.the-race.com/category/formula-1/rss/')
  )
) STRICT;

INSERT INTO source_v6 (
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
)
SELECT
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
FROM source;

DROP TABLE source;
ALTER TABLE source_v6 RENAME TO source;

INSERT INTO source (
  source_id,
  feed_url,
  enabled,
  stop_epoch,
  last_reason_code
) VALUES (
  'racefans-f1-news',
  'https://www.racefans.net/category/formula-1/feed/',
  1,
  1,
  'NEVER_RUN'
);

INSERT INTO source (
  source_id,
  feed_url,
  enabled,
  stop_epoch,
  last_reason_code
) VALUES (
  'the-race-f1-news',
  'https://www.the-race.com/category/formula-1/rss/',
  1,
  1,
  'NEVER_RUN'
);

PRAGMA foreign_keys=ON;
PRAGMA user_version = 6;
