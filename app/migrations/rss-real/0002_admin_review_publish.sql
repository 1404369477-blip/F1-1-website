CREATE TABLE review_bundle (
  bundle_id TEXT PRIMARY KEY CHECK (length(CAST(bundle_id AS BLOB)) BETWEEN 1 AND 256),
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_revision INTEGER NOT NULL CHECK (bundle_revision >= 1),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  public_payload_json TEXT NOT NULL CHECK (json_valid(public_payload_json) AND json_type(public_payload_json) = 'object'),
  public_payload_hash TEXT NOT NULL CHECK (length(public_payload_hash) = 64 AND public_payload_hash NOT GLOB '*[^0-9a-f]*'),
  editor_notes TEXT NOT NULL CHECK (length(editor_notes) <= 2000),
  bundle_hash TEXT NOT NULL UNIQUE CHECK (length(bundle_hash) = 64 AND bundle_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, bundle_revision)
) STRICT;

CREATE INDEX review_bundle_candidate_revision_idx
  ON review_bundle(candidate_id, bundle_revision DESC);

CREATE TABLE review_decision (
  decision_id TEXT PRIMARY KEY CHECK (length(CAST(decision_id AS BLOB)) BETWEEN 1 AND 256),
  bundle_id TEXT NOT NULL UNIQUE REFERENCES review_bundle(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  approved_bundle_hash TEXT CHECK (approved_bundle_hash IS NULL OR (length(approved_bundle_hash) = 64 AND approved_bundle_hash NOT GLOB '*[^0-9a-f]*')),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(trim(rejection_reason)) BETWEEN 1 AND 500),
  decided_at TEXT NOT NULL,
  CHECK (
    (decision = 'approved' AND approved_bundle_hash IS NOT NULL AND rejection_reason IS NULL) OR
    (decision = 'rejected' AND approved_bundle_hash IS NULL AND rejection_reason IS NOT NULL)
  )
) STRICT;

CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY CHECK (length(CAST(publication_id AS BLOB)) BETWEEN 1 AND 256),
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decision(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_id TEXT NOT NULL UNIQUE REFERENCES review_bundle(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL UNIQUE CHECK (
    length(public_id) = 75 AND
    substr(public_id, 1, 11) = 'public-rss-' AND
    substr(public_id, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  approved_bundle_hash TEXT NOT NULL CHECK (length(approved_bundle_hash) = 64 AND approved_bundle_hash NOT GLOB '*[^0-9a-f]*'),
  publish_generation INTEGER NOT NULL DEFAULT 1 CHECK (publish_generation = 1),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('queued', 'published', 'reconcile_wait', 'terminal_failed', 'emergency_stopped', 'superseded')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (publication_status <> 'published' OR published_at IS NOT NULL),
  CHECK (publication_status NOT IN ('queued', 'superseded') OR published_at IS NULL)
) STRICT;

CREATE INDEX publication_status_updated_idx
  ON publication(publication_status, updated_at, public_id);

CREATE TABLE published_projection (
  projection_id TEXT PRIMARY KEY CHECK (length(CAST(projection_id AS BLOB)) BETWEEN 1 AND 256),
  publication_id TEXT NOT NULL UNIQUE REFERENCES publication(publication_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_id TEXT NOT NULL UNIQUE REFERENCES review_bundle(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL UNIQUE,
  publish_generation INTEGER NOT NULL CHECK (publish_generation = 1),
  projection_json TEXT NOT NULL CHECK (json_valid(projection_json) AND json_type(projection_json) = 'object'),
  projection_hash TEXT NOT NULL UNIQUE CHECK (length(projection_hash) = 64 AND projection_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE projection_outbox (
  delivery_id TEXT PRIMARY KEY CHECK (length(CAST(delivery_id AS BLOB)) BETWEEN 1 AND 256),
  publication_id TEXT NOT NULL UNIQUE REFERENCES publication(publication_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type = 'snapshot_sync'),
  snapshot_generation INTEGER NOT NULL CHECK (snapshot_generation >= 1),
  snapshot_manifest_hash TEXT NOT NULL CHECK (length(snapshot_manifest_hash) = 64 AND snapshot_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  reconcile_key TEXT NOT NULL UNIQUE CHECK (length(CAST(reconcile_key AS BLOB)) BETWEEN 1 AND 256),
  task_envelope_json TEXT NOT NULL CHECK (json_valid(task_envelope_json) AND json_type(task_envelope_json) = 'object'),
  task_envelope_hash TEXT NOT NULL CHECK (length(task_envelope_hash) = 64 AND task_envelope_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'succeeded', 'retryable_failed', 'reconcile_wait', 'terminal_failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  lease_token TEXT,
  lease_expires_at TEXT,
  last_reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (snapshot_generation, snapshot_manifest_hash),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (status <> 'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
) STRICT;

CREATE INDEX projection_outbox_status_updated_idx
  ON projection_outbox(status, updated_at, delivery_id);

CREATE TABLE admin_operation (
  operation_id TEXT PRIMARY KEY CHECK (length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 256),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('revision', 'approve', 'reject', 'publish')),
  http_method TEXT NOT NULL CHECK (http_method = 'POST'),
  request_path TEXT NOT NULL CHECK (request_path LIKE '/api/admin/%' AND instr(request_path, '?') = 0 AND instr(request_path, '#') = 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  response_json TEXT NOT NULL CHECK (json_valid(response_json) AND json_type(response_json) = 'object'),
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 64 AND response_hash NOT GLOB '*[^0-9a-f]*'),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 200 AND 599),
  operation_status TEXT NOT NULL CHECK (operation_status IN ('completed', 'failed')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (operation_status = 'completed' AND http_status BETWEEN 200 AND 299 AND reason_code IS NULL) OR
    (operation_status = 'failed' AND http_status BETWEEN 400 AND 599 AND reason_code IS NOT NULL)
  )
) STRICT;

CREATE INDEX admin_operation_created_idx
  ON admin_operation(created_at DESC, operation_id);

CREATE TABLE audit_event (
  audit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE CHECK (length(CAST(event_id AS BLOB)) BETWEEN 1 AND 256),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'review_revision_saved',
    'review_approved',
    'review_rejected',
    'publication_published',
    'publication_superseded',
    'projection_delivery_leased',
    'projection_delivery_succeeded',
    'projection_delivery_retryable_failed',
    'projection_delivery_reconcile_wait',
    'projection_delivery_terminal_failed',
    'projection_delivery_cancelled',
    'emergency_stopped'
  )),
  operation_id TEXT NOT NULL REFERENCES admin_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('candidate', 'bundle', 'decision', 'publication', 'projection', 'delivery')),
  entity_id TEXT NOT NULL CHECK (length(CAST(entity_id AS BLOB)) BETWEEN 1 AND 256),
  actor_ref TEXT NOT NULL CHECK (length(CAST(actor_ref AS BLOB)) BETWEEN 1 AND 256),
  event_json TEXT NOT NULL CHECK (json_valid(event_json) AND json_type(event_json) = 'object'),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_event_operation_seq_idx
  ON audit_event(operation_id, audit_seq);

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
)
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_SOURCE_STALE');
END;

CREATE TRIGGER review_decision_guard_insert
BEFORE INSERT ON review_decision
WHEN NOT EXISTS (
  SELECT 1
  FROM review_bundle AS bundle
  JOIN pending_review_candidate AS candidate
    ON candidate.candidate_id = bundle.candidate_id
  WHERE bundle.bundle_id = NEW.bundle_id
    AND bundle.source_revision = candidate.source_revision
    AND bundle.source_revision = candidate.editor_based_on_source_revision
    AND bundle.source_payload_hash = candidate.source_payload_hash
    AND NOT EXISTS (
      SELECT 1 FROM review_bundle AS newer
      WHERE newer.candidate_id = bundle.candidate_id
        AND newer.bundle_revision > bundle.bundle_revision
    )
    AND (
      (NEW.decision = 'approved' AND NEW.approved_bundle_hash = bundle.bundle_hash) OR
      (NEW.decision = 'rejected' AND NEW.approved_bundle_hash IS NULL)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_STALE');
END;

CREATE TRIGGER publication_guard_insert
BEFORE INSERT ON publication
WHEN NEW.publication_status <> 'queued'
  OR NEW.published_at IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM publication AS existing
    WHERE existing.publication_id = NEW.publication_id
      OR existing.decision_id = NEW.decision_id
      OR existing.bundle_id = NEW.bundle_id
      OR existing.public_id = NEW.public_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM review_decision AS decision
    JOIN review_bundle AS bundle ON bundle.bundle_id = decision.bundle_id
    WHERE decision.decision_id = NEW.decision_id
      AND decision.bundle_id = NEW.bundle_id
      AND decision.decision = 'approved'
      AND decision.approved_bundle_hash = bundle.bundle_hash
      AND NEW.approved_bundle_hash = bundle.bundle_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_APPROVAL_INVALID');
END;

CREATE TRIGGER publication_identity_no_update
BEFORE UPDATE OF decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, created_at ON publication
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER publication_published_at_guard
BEFORE UPDATE OF published_at ON publication
WHEN NOT (
  OLD.publication_status = 'queued' AND
  OLD.published_at IS NULL AND
  NEW.publication_status = 'published' AND
  NEW.published_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_PUBLISHED_AT_IMMUTABLE');
END;

CREATE TRIGGER publication_status_transition_guard
BEFORE UPDATE OF publication_status ON publication
WHEN NOT (
  NEW.publication_status = OLD.publication_status OR
  (OLD.publication_status = 'queued' AND NEW.publication_status IN ('published', 'reconcile_wait', 'terminal_failed', 'emergency_stopped', 'superseded')) OR
  (OLD.publication_status = 'published' AND NEW.publication_status IN ('reconcile_wait', 'terminal_failed', 'emergency_stopped')) OR
  (OLD.publication_status = 'reconcile_wait' AND NEW.publication_status IN ('published', 'terminal_failed', 'emergency_stopped'))
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_STATE_INVALID');
END;

CREATE TRIGGER published_projection_guard_insert
BEFORE INSERT ON published_projection
WHEN NOT EXISTS (
  SELECT 1
  FROM publication
  WHERE publication.publication_id = NEW.publication_id
    AND publication.bundle_id = NEW.bundle_id
    AND publication.public_id = NEW.public_id
    AND publication.publish_generation = NEW.publish_generation
    AND publication.publication_status = 'published'
    AND publication.published_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_PUBLICATION_INVALID');
END;

CREATE TRIGGER projection_outbox_guard_insert
BEFORE INSERT ON projection_outbox
WHEN NEW.status <> 'pending'
  OR NEW.attempt_count <> 0
  OR NEW.lease_token IS NOT NULL
  OR NEW.lease_expires_at IS NOT NULL
  OR NEW.last_reason_code IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM projection_outbox AS existing
    WHERE existing.delivery_id = NEW.delivery_id
      OR existing.publication_id = NEW.publication_id
      OR existing.idempotency_key = NEW.idempotency_key
      OR existing.reconcile_key = NEW.reconcile_key
      OR (
        existing.snapshot_generation = NEW.snapshot_generation AND
        existing.snapshot_manifest_hash = NEW.snapshot_manifest_hash
      )
  )
  OR json_extract(NEW.task_envelope_json, '$.attempt') IS NOT 0
  OR NOT EXISTS (
  SELECT 1
  FROM publication
  WHERE publication.publication_id = NEW.publication_id
    AND publication.publication_status = 'published'
    AND publication.published_at IS NOT NULL
)
  OR json_extract(NEW.task_envelope_json, '$.deliveryId') IS NOT NEW.delivery_id
  OR json_extract(NEW.task_envelope_json, '$.idempotencyKey') IS NOT NEW.idempotency_key
  OR json_extract(NEW.task_envelope_json, '$.reconcileKey') IS NOT NEW.reconcile_key
  OR json_extract(NEW.task_envelope_json, '$.operationType') IS NOT NEW.operation_type
  OR json_extract(NEW.task_envelope_json, '$.snapshot.snapshotGeneration') IS NOT NEW.snapshot_generation
  OR json_extract(NEW.task_envelope_json, '$.snapshot.snapshotManifestHash') IS NOT NEW.snapshot_manifest_hash
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_INVALID');
END;

CREATE TRIGGER projection_outbox_identity_no_update
BEFORE UPDATE OF publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, max_attempts, created_at ON projection_outbox
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER projection_outbox_status_transition_guard
BEFORE UPDATE OF status, attempt_count, lease_token, lease_expires_at, last_reason_code ON projection_outbox
WHEN NOT (
  (
    NEW.status = OLD.status AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS OLD.lease_token AND
    NEW.lease_expires_at IS OLD.lease_expires_at AND
    NEW.last_reason_code IS OLD.last_reason_code
  ) OR
  (
    OLD.status IN ('pending', 'retryable_failed') AND
    NEW.status = 'leased' AND
    NEW.attempt_count = OLD.attempt_count + 1 AND
    NEW.attempt_count <= OLD.max_attempts AND
    NEW.lease_token IS NOT NULL AND
    NEW.lease_expires_at IS NOT NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'pending' AND
    NEW.status IN ('retryable_failed', 'cancelled') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'leased' AND
    NEW.status = 'succeeded' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'leased' AND
    NEW.status IN ('retryable_failed', 'reconcile_wait') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'retryable_failed' AND
    NEW.status = 'cancelled' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'reconcile_wait' AND
    NEW.status = 'succeeded' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'reconcile_wait' AND
    NEW.status IN ('retryable_failed', 'terminal_failed') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_STATE_INVALID');
END;

CREATE TRIGGER audit_event_guard_insert
BEFORE INSERT ON audit_event
WHEN json_extract(NEW.event_json, '$.schemaVersion') IS NOT 'admin-audit-v1'
  OR json_extract(NEW.event_json, '$.eventType') IS NOT NEW.event_type
  OR json_extract(NEW.event_json, '$.operationId') IS NOT NEW.operation_id
  OR json_extract(NEW.event_json, '$.entityType') IS NOT NEW.entity_type
  OR json_extract(NEW.event_json, '$.entityId') IS NOT NEW.entity_id
  OR json_extract(NEW.event_json, '$.actorRef') IS NOT NEW.actor_ref
  OR json_extract(NEW.event_json, '$.occurredAt') IS NOT NEW.created_at
  OR EXISTS (
    SELECT 1
    FROM audit_event AS existing
    WHERE existing.audit_seq = NEW.audit_seq
      OR existing.event_id = NEW.event_id
      OR existing.event_hash = NEW.event_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_INVALID');
END;

CREATE TRIGGER audit_event_predecessor_guard
BEFORE INSERT ON audit_event
WHEN (
  NOT EXISTS (SELECT 1 FROM audit_event) AND
  NEW.previous_event_hash IS NOT NULL
) OR (
  EXISTS (SELECT 1 FROM audit_event) AND
  NEW.previous_event_hash IS NOT (
    SELECT event_hash FROM audit_event ORDER BY audit_seq DESC LIMIT 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_PREDECESSOR_INVALID');
END;

CREATE TRIGGER audit_event_sequence_guard
AFTER INSERT ON audit_event
WHEN NEW.audit_seq <> COALESCE(
  (SELECT MAX(audit_seq) FROM audit_event WHERE audit_seq <> NEW.audit_seq),
  0
) + 1
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_SEQUENCE_INVALID');
END;

CREATE TRIGGER review_bundle_no_update
BEFORE UPDATE ON review_bundle
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_IMMUTABLE');
END;

CREATE TRIGGER review_bundle_no_delete
BEFORE DELETE ON review_bundle
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_IMMUTABLE');
END;

CREATE TRIGGER review_decision_no_update
BEFORE UPDATE ON review_decision
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISION_IMMUTABLE');
END;

CREATE TRIGGER review_decision_no_delete
BEFORE DELETE ON review_decision
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISION_IMMUTABLE');
END;

CREATE TRIGGER published_projection_no_update
BEFORE UPDATE ON published_projection
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_PROJECTION_IMMUTABLE');
END;

CREATE TRIGGER published_projection_no_delete
BEFORE DELETE ON published_projection
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_PROJECTION_IMMUTABLE');
END;

CREATE TRIGGER publication_no_delete
BEFORE DELETE ON publication
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_IMMUTABLE');
END;

CREATE TRIGGER projection_outbox_no_delete
BEFORE DELETE ON projection_outbox
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_IMMUTABLE');
END;

CREATE TRIGGER admin_operation_no_update
BEFORE UPDATE ON admin_operation
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER admin_operation_no_delete
BEFORE DELETE ON admin_operation
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;

PRAGMA user_version = 2;
