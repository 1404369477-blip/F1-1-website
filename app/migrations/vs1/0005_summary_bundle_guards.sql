CREATE TABLE summary (
  summary_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(content_id),
  summary_version_hash TEXT NOT NULL CHECK (length(summary_version_hash) = 64),
  summary_status TEXT NOT NULL CHECK (summary_status IN ('draft','ready','approved','rejected','superseded')),
  payload_json TEXT NOT NULL,
  UNIQUE(content_id, summary_version_hash)
);

CREATE TABLE release_bundle (
  release_bundle_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(content_id),
  summary_id TEXT NOT NULL REFERENCES summary(summary_id),
  bundle_hash TEXT NOT NULL UNIQUE CHECK (length(bundle_hash) = 64),
  release_status TEXT NOT NULL CHECK (release_status IN ('draft','ready','approved','superseded','rejected')),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  payload_json TEXT NOT NULL
);

CREATE TABLE review_decision (
  review_decision_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(content_id),
  summary_id TEXT NOT NULL REFERENCES summary(summary_id),
  release_bundle_id TEXT NOT NULL REFERENCES release_bundle(release_bundle_id),
  payload_json TEXT NOT NULL
);

CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(content_id),
  summary_id TEXT NOT NULL REFERENCES summary(summary_id),
  release_bundle_id TEXT NOT NULL REFERENCES release_bundle(release_bundle_id),
  payload_json TEXT NOT NULL
);
