CREATE TABLE rss_media_candidate (
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  media_url TEXT NOT NULL CHECK (length(media_url) BETWEEN 1 AND 2048 AND media_url LIKE 'https://%'),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes BETWEEN 1 AND 20971520),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, source_revision),
  UNIQUE (candidate_id, source_payload_hash)
) STRICT;

CREATE TABLE machine_summary_draft (
  draft_id TEXT PRIMARY KEY CHECK (length(draft_id) = 70 AND substr(draft_id, 1, 6) = 'draft-' AND substr(draft_id, 7) NOT GLOB '*[^0-9a-f]*'),
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  model TEXT NOT NULL CHECK (model = 'deepseek-chat'),
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*'),
  response_sha256 TEXT NOT NULL CHECK (length(response_sha256) = 64 AND response_sha256 NOT GLOB '*[^0-9a-f]*'),
  title_zh TEXT NOT NULL CHECK (length(trim(title_zh)) BETWEEN 1 AND 400),
  summary_zh TEXT NOT NULL CHECK (length(trim(summary_zh)) BETWEEN 1 AND 1200),
  key_points_zh_json TEXT NOT NULL CHECK (
    json_valid(key_points_zh_json) AND
    json_type(key_points_zh_json) = 'array' AND
    json_array_length(key_points_zh_json) BETWEEN 1 AND 3
  ),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  generated_at TEXT NOT NULL,
  UNIQUE (candidate_id, source_revision, source_payload_hash, model, prompt_sha256)
) STRICT;

CREATE INDEX machine_summary_draft_candidate_revision_idx
  ON machine_summary_draft(candidate_id, source_revision DESC, generated_at DESC);

CREATE TRIGGER rss_media_candidate_insert_guard
BEFORE INSERT ON rss_media_candidate
WHEN EXISTS (
  SELECT 1 FROM rss_media_candidate AS existing
  WHERE existing.candidate_id = NEW.candidate_id
    AND (existing.source_revision = NEW.source_revision OR existing.source_payload_hash = NEW.source_payload_hash)
) OR NOT EXISTS (
  SELECT 1 FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
)
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IDENTITY_INVALID');
END;

CREATE TRIGGER rss_media_candidate_no_update
BEFORE UPDATE ON rss_media_candidate
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IMMUTABLE');
END;

CREATE TRIGGER rss_media_candidate_no_delete
BEFORE DELETE ON rss_media_candidate
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IMMUTABLE');
END;

CREATE TRIGGER machine_summary_draft_insert_guard
BEFORE INSERT ON machine_summary_draft
WHEN EXISTS (
  SELECT 1 FROM machine_summary_draft AS existing
  WHERE existing.draft_id = NEW.draft_id OR (
    existing.candidate_id = NEW.candidate_id AND
    existing.source_revision = NEW.source_revision AND
    existing.source_payload_hash = NEW.source_payload_hash AND
    existing.model = NEW.model AND
    existing.prompt_sha256 = NEW.prompt_sha256
  )
) OR NOT EXISTS (
  SELECT 1 FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
)
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IDENTITY_INVALID');
END;

CREATE TRIGGER machine_summary_draft_no_update
BEFORE UPDATE ON machine_summary_draft
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IMMUTABLE');
END;

CREATE TRIGGER machine_summary_draft_no_delete
BEFORE DELETE ON machine_summary_draft
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IMMUTABLE');
END;

DROP TRIGGER review_bundle_guard_insert;

CREATE TRIGGER review_bundle_guard_insert
BEFORE INSERT ON review_bundle
WHEN NOT EXISTS (
  SELECT 1
  FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
    AND candidate.editor_based_on_source_revision = NEW.source_revision
    AND candidate.editor_title = json_extract(NEW.public_payload_json, '$.titleZh')
    AND candidate.editor_excerpt = json_extract(NEW.public_payload_json, '$.summaryZh')
    AND COALESCE(candidate.editor_notes, '') = NEW.editor_notes
    AND json_extract(NEW.public_payload_json, '$.candidateId') = candidate.candidate_id
    AND json_extract(NEW.public_payload_json, '$.sourceId') = candidate.source_id
    AND json_extract(NEW.public_payload_json, '$.sourceRevision') = candidate.source_revision
    AND json_extract(NEW.public_payload_json, '$.sourcePayloadHash') = candidate.source_payload_hash
    AND json_extract(NEW.public_payload_json, '$.canonicalUrl') = candidate.canonical_url
    AND json_extract(NEW.public_payload_json, '$.sourceTitle') = candidate.title
    AND json_extract(NEW.public_payload_json, '$.sourcePublishedAt') = candidate.published_at
    AND (
      (
        json_array_length(json_extract(NEW.public_payload_json, '$.media')) = 0 AND
        NOT EXISTS (
          SELECT 1 FROM rss_media_candidate AS media
          WHERE media.candidate_id = candidate.candidate_id
            AND media.source_revision = candidate.source_revision
            AND media.source_payload_hash = candidate.source_payload_hash
        )
      ) OR (
        json_array_length(json_extract(NEW.public_payload_json, '$.media')) = 1 AND
        EXISTS (
          SELECT 1 FROM rss_media_candidate AS media
          WHERE media.candidate_id = candidate.candidate_id
            AND media.source_revision = candidate.source_revision
            AND media.source_payload_hash = candidate.source_payload_hash
            AND json_extract(NEW.public_payload_json, '$.media[0].kind') = 'source_image'
            AND json_extract(NEW.public_payload_json, '$.media[0].url') = media.media_url
            AND json_extract(NEW.public_payload_json, '$.media[0].mimeType') = media.media_type
            AND json_extract(NEW.public_payload_json, '$.media[0].declaredBytes') = media.declared_bytes
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_SOURCE_STALE');
END;

PRAGMA user_version = 4;
