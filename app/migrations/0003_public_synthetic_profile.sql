CREATE TABLE fixture_profile_ledger (
  profile_id TEXT PRIMARY KEY CHECK (profile_id IN ('m3-shadow', 'public-synthetic')),
  sqlite_path TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  fixture_set TEXT NOT NULL,
  fixture_manifest_hash TEXT NOT NULL CHECK (length(fixture_manifest_hash) = 64),
  fixture_graph_hash TEXT NOT NULL CHECK (length(fixture_graph_hash) = 64),
  row_counts_json TEXT NOT NULL,
  synthetic_only INTEGER NOT NULL CHECK (synthetic_only IN (0, 1)),
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  writes_to_base INTEGER NOT NULL CHECK (writes_to_base = 0),
  real_content_imported INTEGER NOT NULL CHECK (real_content_imported = 0),
  manifest_root_sha256 TEXT CHECK (manifest_root_sha256 IS NULL OR length(manifest_root_sha256) = 64),
  profile_ledger_root_sha256 TEXT CHECK (profile_ledger_root_sha256 IS NULL OR length(profile_ledger_root_sha256) = 64),
  generator_root_sha256 TEXT CHECK (generator_root_sha256 IS NULL OR length(generator_root_sha256) = 64),
  validator_root_sha256 TEXT CHECK (validator_root_sha256 IS NULL OR length(validator_root_sha256) = 64),
  recorded_at TEXT NOT NULL
);

CREATE TABLE public_captured_item (
  capture_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_config_fixture(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  content_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);

CREATE TABLE public_content (
  content_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_config_fixture(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  capture_id TEXT NOT NULL UNIQUE REFERENCES public_captured_item(capture_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  editorial_category TEXT NOT NULL CHECK (editorial_category IN ('race_news', 'driver_social', 'legends_history', 'paddock_fun')),
  content_version_hash TEXT NOT NULL UNIQUE CHECK (length(content_version_hash) = 64),
  content_status TEXT NOT NULL CHECK (content_status = 'published'),
  published_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE public_summary (
  summary_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  summary_version_hash TEXT NOT NULL UNIQUE CHECK (length(summary_version_hash) = 64),
  summary_status TEXT NOT NULL CHECK (summary_status = 'approved'),
  payload_json TEXT NOT NULL
);

CREATE TABLE public_media_candidate (
  media_candidate_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  media_hash TEXT NOT NULL UNIQUE CHECK (length(media_hash) = 64),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'selected'),
  payload_json TEXT NOT NULL
);

CREATE TABLE public_release_bundle (
  release_bundle_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  summary_id TEXT NOT NULL UNIQUE REFERENCES public_summary(summary_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_hash TEXT NOT NULL UNIQUE CHECK (length(bundle_hash) = 64),
  release_status TEXT NOT NULL CHECK (release_status = 'approved'),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  payload_json TEXT NOT NULL
);

CREATE TABLE public_review_decision (
  review_decision_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  summary_id TEXT NOT NULL UNIQUE REFERENCES public_summary(summary_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  release_bundle_id TEXT NOT NULL UNIQUE REFERENCES public_release_bundle(release_bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  approved_bundle_hash TEXT NOT NULL UNIQUE CHECK (length(approved_bundle_hash) = 64),
  decision TEXT NOT NULL CHECK (decision = 'approved'),
  immutable INTEGER NOT NULL CHECK (immutable = 1),
  payload_json TEXT NOT NULL
);

CREATE TABLE public_publication (
  publication_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  summary_id TEXT NOT NULL UNIQUE REFERENCES public_summary(summary_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  release_bundle_id TEXT NOT NULL UNIQUE REFERENCES public_release_bundle(release_bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL UNIQUE CHECK (public_id GLOB 'public-[a-z0-9-]*'),
  approved_bundle_hash TEXT NOT NULL UNIQUE CHECK (length(approved_bundle_hash) = 64),
  published_version_hash TEXT NOT NULL UNIQUE CHECK (length(published_version_hash) = 64),
  publication_status TEXT NOT NULL CHECK (publication_status = 'published'),
  published_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX public_publication_published_idx
  ON public_publication (published_at DESC, public_id DESC);

CREATE TABLE published_projection (
  projection_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE REFERENCES public_publication(public_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  content_id TEXT NOT NULL UNIQUE REFERENCES public_content(content_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  summary_id TEXT NOT NULL UNIQUE REFERENCES public_summary(summary_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  release_bundle_id TEXT NOT NULL UNIQUE REFERENCES public_release_bundle(release_bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  published_version_hash TEXT NOT NULL UNIQUE CHECK (length(published_version_hash) = 64),
  projection_status TEXT NOT NULL CHECK (projection_status = 'published'),
  synthetic_only INTEGER NOT NULL CHECK (synthetic_only = 1),
  external_calls INTEGER NOT NULL CHECK (external_calls = 0),
  payload_json TEXT NOT NULL
);
