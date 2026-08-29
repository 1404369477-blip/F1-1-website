-- F1+1 additive migration 0009: bilingual refinement v1.
--
-- This file is a schema candidate for a disposable schema-8 copy.  It starts
-- write-closed.  A same-UID trusted Admin may activate it only through
-- the 0007 InternalOperationGateway truth, a one-time permit, an immutable
-- audit row, disabled phase, zero egress and exact epoch fences.
--
-- The opener must verify the raw migration hash, the canonical migration
-- hash, and the exact schema-8 preimage, then create this connection-local
-- TEMP table before executing the file:
--   CREATE TEMP TABLE migration_0009_preflight(
--     source_user_version INTEGER NOT NULL,
--     source_schema_sha256 TEXT NOT NULL,
--     source_0008_raw_sha256 TEXT NOT NULL,
--     source_0008_canonical_sha256 TEXT NOT NULL,
--     target_schema_sha256 TEXT NOT NULL,
--     apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN (0,1))
--   ) STRICT;
--   INSERT INTO migration_0009_preflight VALUES (8, ..., ..., ..., ..., 1);
--
-- Migration identity algorithm v1 replaces the lower-hex value tagged
-- MIGRATION_CANONICAL_SHA256 with 64 ASCII zeroes before hashing.
-- MIGRATION_CANONICAL_SHA256=1b6a3814c0ac6ec65cb46eaec5b39a415848f2acc5226d69ac940e995796b273

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0009_assert (
  value INTEGER NOT NULL CHECK (value = 1)
) STRICT;

INSERT INTO migration_0009_assert (value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM sqlite_temp_master
    WHERE type = 'table' AND name = 'migration_0009_preflight'
  )
  AND (SELECT source_user_version FROM migration_0009_preflight) = 8
  AND (SELECT source_schema_sha256 FROM migration_0009_preflight) = 'db788b873d903f4a7224061a7c4628954244790d4d5794aa98ad07e746cabfc5'
  AND (SELECT source_0008_raw_sha256 FROM migration_0009_preflight) = 'f11756ac22bff56f7f42b640e816c36ffcf12a863eed42b17afc156907ac1246'
  AND (SELECT source_0008_canonical_sha256 FROM migration_0009_preflight) = 'f78b9f98227fcfb18de9bf7b09fef86cd62fd7c9282edb0bfb9fd1528fd2913a'
  AND (SELECT apply_enabled FROM migration_0009_preflight) = 1
  AND (SELECT COUNT(*) FROM migration_0009_preflight) = 1
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE name IN (
      'bilingual_authority_capability_v1',
      'bilingual_authority_permit_v1',
      'bilingual_authority_audit_v1',
      'bilingual_authority_bridge_marker_v1',
      'bilingual_candidate_lineage_v1',
      'bilingual_lineage_safety_decision_v1',
      'bilingual_lineage_effective_safety_v1',
      'bilingual_operation_link_v1',
      'bilingual_language_slot_v1',
      'bilingual_model_receipt_v1',
      'bilingual_language_slot_draft_v1',
      'bilingual_bundle_v1',
      'bilingual_approval_v1',
      'bilingual_publication_v1',
      'bilingual_public_projection_v1',
      'bilingual_public_projection_active_v1',
      'bilingual_publication_outbox_v1'
    )
  )
  THEN 1 ELSE 0 END;

CREATE TABLE bilingual_authority_capability_v1 (
  capability_id TEXT PRIMARY KEY CHECK (capability_id = 'bilingual-v1'),
  schema_sha256 TEXT NOT NULL CHECK (length(schema_sha256) = 64 AND schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('closed', 'enabled')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('AUTHORITY_EXTENSION_REQUIRED', 'READY')),
  extension_sha256 TEXT CHECK (extension_sha256 IS NULL OR (length(extension_sha256) = 64 AND extension_sha256 NOT GLOB '*[^0-9a-f]*')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_by_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  authority_receipt_sha256 TEXT CHECK (authority_receipt_sha256 IS NULL OR (length(authority_receipt_sha256) = 64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*')),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  CHECK ((version = 1 AND enabled = 0 AND status = 'closed' AND reason_code = 'AUTHORITY_EXTENSION_REQUIRED'
          AND extension_sha256 IS NULL AND updated_by_operation_id IS NULL AND authority_receipt_sha256 IS NULL)
      OR (version > 1 AND ((enabled = 0 AND status = 'closed' AND reason_code = 'AUTHORITY_EXTENSION_REQUIRED')
          OR (enabled = 1 AND status = 'enabled' AND reason_code = 'READY' AND extension_sha256 IS NOT NULL))
          AND updated_by_operation_id IS NOT NULL AND authority_receipt_sha256 IS NOT NULL))
) STRICT;

INSERT INTO bilingual_authority_capability_v1
  (capability_id, schema_sha256, enabled, status, reason_code, extension_sha256, version, updated_by_operation_id, authority_receipt_sha256, updated_at)
SELECT 'bilingual-v1', target_schema_sha256, 0, 'closed', 'AUTHORITY_EXTENSION_REQUIRED', NULL, 1, NULL, NULL,
  '2026-08-24T00:00:00.000Z' FROM migration_0009_preflight;

CREATE TABLE bilingual_authority_permit_v1 (
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('enable', 'close')),
  expected_version INTEGER NOT NULL UNIQUE CHECK (expected_version >= 1),
  target_schema_sha256 TEXT NOT NULL CHECK (length(target_schema_sha256) = 64 AND target_schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  extension_sha256 TEXT NOT NULL CHECK (length(extension_sha256) = 64 AND extension_sha256 NOT GLOB '*[^0-9a-f]*'),
  one_time_nonce TEXT NOT NULL UNIQUE CHECK (length(CAST(one_time_nonce AS BLOB)) = 43),
  request_hash TEXT NOT NULL UNIQUE CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  authority_receipt_sha256 TEXT NOT NULL UNIQUE CHECK (length(authority_receipt_sha256) = 64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  consumed_at TEXT CHECK (consumed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', consumed_at) = consumed_at),
  CHECK (request_hash <> authority_receipt_sha256)
) STRICT;

CREATE TABLE bilingual_authority_audit_v1 (
  event_id TEXT PRIMARY KEY,
  from_state TEXT NOT NULL CHECK (from_state IN ('closed', 'enabled')),
  to_state TEXT NOT NULL CHECK (to_state IN ('closed', 'enabled')),
  from_version INTEGER NOT NULL CHECK (from_version >= 1),
  to_version INTEGER NOT NULL CHECK (to_version = from_version + 1),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  permit_id TEXT NOT NULL UNIQUE REFERENCES bilingual_authority_permit_v1(permit_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  receipt_sha256 TEXT NOT NULL UNIQUE CHECK (length(receipt_sha256) = 64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at)
) STRICT;

CREATE TABLE bilingual_authority_bridge_marker_v1 (
  bridge_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('enable', 'close')),
  target_schema_sha256 TEXT NOT NULL CHECK (length(target_schema_sha256) = 64 AND target_schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  authority_receipt_sha256 TEXT NOT NULL UNIQUE CHECK (length(authority_receipt_sha256) = 64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  consumed_at TEXT CHECK (consumed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', consumed_at) = consumed_at)
) STRICT;

CREATE TRIGGER bilingual_authority_bridge_marker_insert_guard
BEFORE INSERT ON bilingual_authority_bridge_marker_v1
WHEN NOT EXISTS (
  SELECT 1 FROM quick_launch_authority_permit_v2 p
  JOIN quick_launch_authority_v2 a ON a.capability_id = p.capability_id
  JOIN internal_operation op ON op.operation_id = p.operation_id
  WHERE p.operation_id = NEW.operation_id AND p.action = NEW.action AND p.consumed_at = NEW.created_at
    AND p.authority_receipt_sha256 = NEW.authority_receipt_sha256
    AND a.schema_sha256 = NEW.target_schema_sha256 AND a.authority_receipt_sha256 = NEW.authority_receipt_sha256
    AND op.state = 'authorized' AND op.phase = 'disabled' AND op.egress_class = 'none'
    AND ((NEW.action = 'enable' AND a.state = 'enabled'
          AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id = 'bilingual_auto_refine') = 'enabled'
          AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id = 'bilingual_manual_mutation') = 'enabled')
      OR (NEW.action = 'close' AND a.state = 'closed'
          AND (SELECT status FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1') = 'enabled'))
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_INVALID'); END;
CREATE TRIGGER bilingual_authority_bridge_marker_update_guard
BEFORE UPDATE ON bilingual_authority_bridge_marker_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.bridge_id <> OLD.bridge_id OR NEW.operation_id <> OLD.operation_id
  OR NEW.action <> OLD.action OR NEW.target_schema_sha256 <> OLD.target_schema_sha256
  OR NEW.authority_receipt_sha256 <> OLD.authority_receipt_sha256 OR NEW.created_at <> OLD.created_at
  OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_authority_bridge_marker_no_delete BEFORE DELETE ON bilingual_authority_bridge_marker_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_permit_insert_guard
BEFORE INSERT ON bilingual_authority_permit_v1
WHEN NOT EXISTS (
  SELECT 1 FROM internal_operation op
  JOIN owner_authorization_handoff h ON h.handoff_id = op.authorization_handoff_id
  JOIN internal_control c ON c.singleton_id = 1
  JOIN bilingual_authority_capability_v1 a ON a.capability_id = 'bilingual-v1'
  WHERE op.operation_id = NEW.operation_id AND op.state = 'authorized'
    AND op.owner_process = 'admin_http' AND op.operation_kind = 'phase_control'
    AND op.capability_class = 'control' AND op.policy_id = 'p-phase-control-disabled'
    AND op.control_action = 'fence_update' AND op.phase = 'disabled' AND op.egress_class = 'none'
    AND op.expected_schema_sha256 = NEW.target_schema_sha256 AND NEW.request_hash = op.request_hash
    AND h.consumed_by_operation_id = op.operation_id
    AND op.updated_at = NEW.created_at AND h.verified_at <= NEW.created_at AND h.expires_at > NEW.created_at
    AND c.phase = 'disabled' AND c.global_stop_state = 'stopped' AND c.emergency_stop_state = 'clear'
    AND c.recovery_state = 'fenced'
    AND op.source_config_epoch = c.source_config_epoch AND op.source_safety_epoch = c.source_safety_epoch
    AND op.authorization_version = c.authorization_version AND op.policy_epoch = c.policy_epoch
    AND op.recovery_epoch = c.recovery_epoch AND op.expected_writer_epoch = c.writer_epoch
    AND a.version = NEW.expected_version
    AND (NEW.target_schema_sha256 = a.schema_sha256 OR EXISTS (
      SELECT 1 FROM bilingual_authority_bridge_marker_v1 m
      WHERE m.operation_id = NEW.operation_id AND m.action = NEW.action
        AND m.target_schema_sha256 = NEW.target_schema_sha256
        AND m.authority_receipt_sha256 = NEW.authority_receipt_sha256
        AND m.created_at = NEW.created_at AND m.consumed_at IS NULL
    ))
    AND ((NEW.action = 'enable' AND a.status = 'closed') OR (NEW.action = 'close' AND a.status = 'enabled'))
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_INVALID'); END;

CREATE TRIGGER bilingual_authority_permit_update_guard
BEFORE UPDATE ON bilingual_authority_permit_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id <> OLD.permit_id OR NEW.operation_id <> OLD.operation_id
  OR NEW.action <> OLD.action OR NEW.expected_version <> OLD.expected_version OR NEW.target_schema_sha256 <> OLD.target_schema_sha256
  OR NEW.extension_sha256 <> OLD.extension_sha256 OR NEW.one_time_nonce <> OLD.one_time_nonce
  OR NEW.request_hash <> OLD.request_hash OR NEW.authority_receipt_sha256 <> OLD.authority_receipt_sha256
  OR NEW.created_at <> OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_IMMUTABLE'); END;
CREATE TRIGGER bilingual_authority_permit_no_delete BEFORE DELETE ON bilingual_authority_permit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_transition_guard
BEFORE UPDATE ON bilingual_authority_capability_v1
WHEN NEW.capability_id <> OLD.capability_id OR NEW.schema_sha256 <> OLD.schema_sha256 OR NEW.version <> OLD.version + 1
  OR NOT ((OLD.status = 'closed' AND NEW.status = 'enabled' AND OLD.enabled = 0 AND NEW.enabled = 1
            AND NEW.reason_code = 'READY' AND NEW.extension_sha256 IS NOT NULL)
       OR (OLD.status = 'enabled' AND NEW.status = 'closed' AND OLD.enabled = 1 AND NEW.enabled = 0
            AND NEW.reason_code = 'AUTHORITY_EXTENSION_REQUIRED'))
  OR NEW.updated_by_operation_id IS NULL OR NEW.authority_receipt_sha256 IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_authority_permit_v1 p
    WHERE p.operation_id = NEW.updated_by_operation_id AND p.expected_version = OLD.version
      AND p.consumed_at IS NULL AND p.created_at = NEW.updated_at
      AND p.extension_sha256 = NEW.extension_sha256
      AND p.authority_receipt_sha256 = NEW.authority_receipt_sha256
      AND ((p.action = 'enable' AND NEW.status = 'enabled') OR (p.action = 'close' AND NEW.status = 'closed'))
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_authority_transition_consume
AFTER UPDATE ON bilingual_authority_capability_v1
BEGIN
  UPDATE bilingual_authority_permit_v1 SET consumed_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id AND expected_version = OLD.version AND consumed_at IS NULL;
  UPDATE bilingual_authority_bridge_marker_v1 SET consumed_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id
    AND action = CASE NEW.status WHEN 'enabled' THEN 'enable' ELSE 'close' END AND consumed_at IS NULL;
  INSERT INTO bilingual_authority_audit_v1 VALUES (
    'bilingual-authority-v1-' || NEW.version, OLD.status, NEW.status, OLD.version, NEW.version,
    NEW.updated_by_operation_id,
    (SELECT permit_id FROM bilingual_authority_permit_v1 WHERE expected_version = OLD.version),
    NEW.authority_receipt_sha256, NEW.updated_at
  );
  UPDATE internal_operation SET state = 'succeeded', version = version + 1,
    result_hash = NEW.authority_receipt_sha256, reason_code = 'AUTHORITY_TRANSITION_COMMITTED', updated_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id AND state = 'authorized';
  INSERT INTO internal_operation_audit(event_id, operation_id, event_type, actor_ref, event_json, previous_event_hash, event_hash, created_at)
  VALUES ('bilingual-authority-v1-' || NEW.version, NEW.updated_by_operation_id, 'operation_succeeded', 'admin_http',
    json_object('capabilityId', 'bilingual-v1', 'state', NEW.status, 'version', NEW.version),
    (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1),
    (SELECT request_hash FROM bilingual_authority_permit_v1 WHERE expected_version = OLD.version), NEW.updated_at);
END;

CREATE TRIGGER bilingual_authority_capability_v1_no_insert
BEFORE INSERT ON bilingual_authority_capability_v1
BEGIN
  SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_FIXED_SET');
END;

CREATE TRIGGER bilingual_authority_capability_v1_no_delete
BEFORE DELETE ON bilingual_authority_capability_v1
BEGIN
  SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED');
END;
CREATE TRIGGER bilingual_authority_audit_no_update BEFORE UPDATE ON bilingual_authority_audit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER bilingual_authority_audit_no_delete BEFORE DELETE ON bilingual_authority_audit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TABLE bilingual_candidate_lineage_v1 (
  candidate_id TEXT PRIMARY KEY REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL UNIQUE CHECK (length(CAST(public_id AS BLOB)) BETWEEN 1 AND 256),
  source_id TEXT NOT NULL REFERENCES source(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  input_content_hash TEXT NOT NULL CHECK (length(input_content_hash) = 64 AND input_content_hash NOT GLOB '*[^0-9a-f]*'),
  source_fact_set_hash TEXT NOT NULL CHECK (length(source_fact_set_hash) = 64 AND source_fact_set_hash NOT GLOB '*[^0-9a-f]*'),
  source_release_hash TEXT NOT NULL CHECK (length(source_release_hash) = 64 AND source_release_hash NOT GLOB '*[^0-9a-f]*'),
  copy_risk_status TEXT NOT NULL CHECK (copy_risk_status IN ('unknown', 'screen_passed', 'blocked')),
  rights_status TEXT NOT NULL CHECK (rights_status IN ('unknown', 'clear', 'blocked')),
  deletion_status TEXT NOT NULL CHECK (deletion_status IN ('unknown', 'clear', 'blocked')),
  media_status TEXT NOT NULL CHECK (media_status IN ('none', 'allowed', 'unknown', 'blocked')),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  UNIQUE (candidate_id, source_revision, input_content_hash, source_fact_set_hash, source_release_hash)
) STRICT;

-- The append-only decision chain is the authority truth for copyright,
-- rights, deletion and media safety.  The mutable lineage columns below are
-- only a cache/projection; every consuming guard rechecks the latest,
-- unexpired decision so expiry never depends on a background writer.
CREATE TABLE bilingual_lineage_safety_decision_v1 (
  decision_id TEXT PRIMARY KEY CHECK (length(CAST(decision_id AS BLOB)) BETWEEN 1 AND 256),
  decision_seq INTEGER NOT NULL CHECK (decision_seq >= 1),
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES source(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  input_content_hash TEXT NOT NULL CHECK (length(input_content_hash) = 64 AND input_content_hash NOT GLOB '*[^0-9a-f]*'),
  source_registry_revision INTEGER NOT NULL CHECK (source_registry_revision >= 1),
  source_identity_sha256 TEXT NOT NULL CHECK (length(source_identity_sha256) = 64 AND source_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_config_revision INTEGER NOT NULL CHECK (source_config_revision >= 1),
  source_authorization_receipt_sha256 TEXT NOT NULL CHECK (length(source_authorization_receipt_sha256) = 64 AND source_authorization_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_policy_sha256 TEXT NOT NULL CHECK (length(source_policy_sha256) = 64 AND source_policy_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_config_epoch INTEGER NOT NULL CHECK (source_config_epoch >= 1),
  source_safety_epoch INTEGER NOT NULL CHECK (source_safety_epoch >= 1),
  authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
  policy_epoch INTEGER NOT NULL CHECK (policy_epoch >= 1),
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 1),
  control_source_config_epoch INTEGER NOT NULL CHECK (control_source_config_epoch >= 1),
  control_source_safety_epoch INTEGER NOT NULL CHECK (control_source_safety_epoch >= 1),
  control_authorization_version INTEGER NOT NULL CHECK (control_authorization_version >= 1),
  control_policy_epoch INTEGER NOT NULL CHECK (control_policy_epoch >= 1),
  control_recovery_epoch INTEGER NOT NULL CHECK (control_recovery_epoch >= 1),
  writer_epoch INTEGER NOT NULL CHECK (writer_epoch >= 1),
  source_authorization_expires_at TEXT CHECK (source_authorization_expires_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', source_authorization_expires_at) = source_authorization_expires_at),
  authority_context_hash TEXT NOT NULL CHECK (length(authority_context_hash) = 64 AND authority_context_hash NOT GLOB '*[^0-9a-f]*'),
  action TEXT NOT NULL CHECK (action IN ('clear', 'block', 'withdraw', 'expire')),
  copy_risk_status TEXT NOT NULL CHECK (copy_risk_status IN ('unknown', 'screen_passed', 'blocked')),
  rights_status TEXT NOT NULL CHECK (rights_status IN ('unknown', 'clear', 'blocked')),
  deletion_status TEXT NOT NULL CHECK (deletion_status IN ('unknown', 'clear', 'blocked')),
  media_status TEXT NOT NULL CHECK (media_status IN ('none', 'allowed', 'unknown', 'blocked')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('MANUAL_CLEAR', 'COPY_RISK', 'RIGHTS_BLOCKED', 'DELETION_BLOCKED', 'MEDIA_BLOCKED', 'OPERATOR_WITHDRAW', 'EXPIRED')),
  operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  reviewer_actor_hash TEXT NOT NULL CHECK (length(reviewer_actor_hash) = 64 AND reviewer_actor_hash NOT GLOB '*[^0-9a-f]*'),
  fresh_verification_digest TEXT NOT NULL UNIQUE CHECK (length(fresh_verification_digest) = 64 AND fresh_verification_digest NOT GLOB '*[^0-9a-f]*'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  resource_hash TEXT NOT NULL CHECK (length(resource_hash) = 64 AND resource_hash NOT GLOB '*[^0-9a-f]*'),
  supersedes_decision_id TEXT UNIQUE REFERENCES bilingual_lineage_safety_decision_v1(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  verified_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', verified_at) = verified_at),
  decided_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) = decided_at),
  expires_at TEXT CHECK (expires_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) = expires_at),
  UNIQUE (candidate_id, decision_seq),
  CHECK (unixepoch(decided_at) - unixepoch(verified_at) BETWEEN 0 AND 300),
  CHECK ((action = 'clear' AND copy_risk_status = 'screen_passed' AND rights_status = 'clear' AND deletion_status = 'clear'
          AND media_status IN ('none', 'allowed') AND reason_code = 'MANUAL_CLEAR' AND expires_at > decided_at)
      OR (action = 'block' AND expires_at IS NULL AND reason_code IN ('COPY_RISK', 'RIGHTS_BLOCKED', 'DELETION_BLOCKED', 'MEDIA_BLOCKED')
          AND (copy_risk_status = 'blocked' OR rights_status = 'blocked' OR deletion_status = 'blocked' OR media_status = 'blocked'))
      OR (action = 'withdraw' AND copy_risk_status = 'unknown' AND rights_status = 'unknown' AND deletion_status = 'unknown'
          AND media_status = 'unknown' AND reason_code = 'OPERATOR_WITHDRAW' AND expires_at IS NULL)
      OR (action = 'expire' AND copy_risk_status = 'unknown' AND rights_status = 'unknown' AND deletion_status = 'unknown'
          AND media_status = 'unknown' AND reason_code = 'EXPIRED' AND expires_at IS NULL))
) STRICT;

CREATE VIEW bilingual_lineage_effective_safety_v1 AS
SELECT decision.*
FROM bilingual_lineage_safety_decision_v1 decision
JOIN source_registry_v1 registry ON registry.source_id = decision.source_id
JOIN source_registry_rss_config_v1 config ON config.source_id = decision.source_id
JOIN internal_control control ON control.singleton_id = 1
WHERE NOT EXISTS (
  SELECT 1 FROM bilingual_lineage_safety_decision_v1 later
  WHERE later.candidate_id = decision.candidate_id AND later.decision_seq > decision.decision_seq
)
AND registry.revision = decision.source_registry_revision
AND registry.identity_sha256 = decision.source_identity_sha256
AND registry.enabled = 1 AND registry.lifecycle_status = 'active'
AND registry.source_kind = 'rss' AND registry.collection_mode = 'rss'
AND registry.normalization_status = 'valid' AND registry.dedup_status IN ('unique', 'linked_existing')
AND registry.adapter_status = 'ready'
AND registry.adapter_authorization_status = 'valid' AND registry.platform_allowed = 'allowed'
AND registry.authorization_expires_at IS decision.source_authorization_expires_at
AND registry.source_stop_status = 'clear'
AND registry.source_config_epoch = decision.source_config_epoch
AND registry.source_safety_epoch = decision.source_safety_epoch
AND registry.authorization_version = decision.authorization_version
AND registry.policy_epoch = decision.policy_epoch
AND registry.recovery_epoch = decision.recovery_epoch
AND config.source_revision = decision.source_config_revision
AND config.authorization_receipt_sha256 = decision.source_authorization_receipt_sha256
AND config.source_policy_sha256 = decision.source_policy_sha256
AND control.source_config_epoch = decision.control_source_config_epoch
AND control.source_safety_epoch = decision.control_source_safety_epoch
AND control.authorization_version = decision.control_authorization_version
AND control.policy_epoch = decision.control_policy_epoch
AND control.recovery_epoch = decision.control_recovery_epoch
AND control.writer_epoch = decision.writer_epoch;

CREATE TABLE bilingual_operation_link_v1 (
  link_id TEXT PRIMARY KEY CHECK (length(CAST(link_id AS BLOB)) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  parent_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  language TEXT CHECK (language IS NULL OR language IN ('zh-CN', 'en')),
  semantic_action TEXT NOT NULL CHECK (semantic_action IN (
    'create_lineage', 'refresh_lineage', 'decide_safety', 'refine_both', 'refine_language', 'retry_language', 'rerun_language',
    'commit_draft', 'create_bundle', 'approve', 'reject', 'publish',
    'correct', 'withdraw', 'create_projection', 'activate_projection',
    'enqueue_delivery', 'reconcile'
  )),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 0 AND 3),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  CHECK ((semantic_action IN ('refine_both', 'create_lineage', 'refresh_lineage', 'decide_safety', 'create_bundle') AND parent_operation_id IS NULL AND language IS NULL)
      OR (semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND language IS NOT NULL)
      OR (semantic_action NOT IN ('refine_both', 'create_lineage', 'refresh_lineage', 'decide_safety', 'create_bundle', 'refine_language', 'retry_language', 'rerun_language') AND parent_operation_id IS NOT NULL AND language IS NOT NULL)),
  CHECK (candidate_id IS NOT NULL OR semantic_action = 'reconcile'),
  UNIQUE (operation_id, semantic_action, language, attempt_number)
) STRICT;

-- One real external operation owns one language attempt and, when it is the
-- zh carrier, one aggregate carrier role.  Semantic labels cannot be changed
-- to manufacture a second parent or a duplicate retry/rerun identity.
CREATE UNIQUE INDEX bilingual_operation_link_language_attempt_v1
ON bilingual_operation_link_v1(operation_id, language, attempt_number)
WHERE semantic_action IN ('refine_language', 'retry_language', 'rerun_language');
-- The language attempt number is a candidate-language ledger identity, not an
-- operation-local label.  This index is also the transaction-level CAS: after
-- one writer claims the next attempt, a serialized/concurrent contender cannot
-- bypass it by choosing another operation id or semantic action.
CREATE UNIQUE INDEX bilingual_operation_link_candidate_language_attempt_v1
ON bilingual_operation_link_v1(candidate_id, language, attempt_number)
WHERE semantic_action IN ('refine_language', 'retry_language', 'rerun_language');
CREATE UNIQUE INDEX bilingual_operation_link_carrier_role_v1
ON bilingual_operation_link_v1(operation_id)
WHERE semantic_action = 'refine_both';

CREATE TABLE bilingual_language_slot_v1 (
  slot_id TEXT PRIMARY KEY CHECK (length(CAST(slot_id AS BLOB)) BETWEEN 1 AND 256),
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state TEXT NOT NULL CHECK (state IN ('missing', 'queued', 'running', 'complete', 'blocked', 'failed', 'reconcile_required', 'stale')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  input_content_hash TEXT NOT NULL CHECK (length(input_content_hash) = 64 AND input_content_hash NOT GLOB '*[^0-9a-f]*'),
  source_fact_set_hash TEXT NOT NULL CHECK (length(source_fact_set_hash) = 64 AND source_fact_set_hash NOT GLOB '*[^0-9a-f]*'),
  source_release_hash TEXT NOT NULL CHECK (length(source_release_hash) = 64 AND source_release_hash NOT GLOB '*[^0-9a-f]*'),
  prompt_schema_version TEXT NOT NULL CHECK (length(prompt_schema_version) BETWEEN 1 AND 80),
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*'),
  model_route_receipt_hash TEXT CHECK (model_route_receipt_hash IS NULL OR (length(model_route_receipt_hash) = 64 AND model_route_receipt_hash NOT GLOB '*[^0-9a-f]*')),
  draft_hash TEXT CHECK (draft_hash IS NULL OR (length(draft_hash) = 64 AND draft_hash NOT GLOB '*[^0-9a-f]*')),
  current_attempt_id TEXT REFERENCES internal_external_attempt(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  current_attempt_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(trim(failure_reason)) BETWEEN 1 AND 120),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  UNIQUE (candidate_id, language),
  CHECK ((state = 'complete') = (draft_hash IS NOT NULL AND model_route_receipt_hash IS NOT NULL AND failure_reason IS NULL)),
  CHECK (state IN ('missing', 'queued', 'running', 'complete', 'stale') OR failure_reason IS NOT NULL),
  CHECK ((current_attempt_id IS NULL) = (current_attempt_operation_id IS NULL))
) STRICT;

CREATE TABLE bilingual_model_receipt_v1 (
  receipt_id TEXT PRIMARY KEY CHECK (length(CAST(receipt_id AS BLOB)) BETWEEN 1 AND 256),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES internal_external_attempt(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  parent_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  slot_id TEXT NOT NULL REFERENCES bilingual_language_slot_v1(slot_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  attempt_state TEXT NOT NULL CHECK (attempt_state IN ('intent_committed', 'started', 'response_committed', 'reconcile_required', 'terminal_failed')),
  model_route_ref TEXT NOT NULL CHECK (length(CAST(model_route_ref AS BLOB)) BETWEEN 1 AND 256),
  prompt_schema_version TEXT NOT NULL CHECK (length(prompt_schema_version) BETWEEN 1 AND 80),
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_receipt_json TEXT NOT NULL CHECK (json_valid(route_receipt_json) AND json_type(route_receipt_json) = 'object'),
  route_receipt_hash TEXT NOT NULL CHECK (length(route_receipt_hash) = 64 AND route_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  budget_reservation_id TEXT NOT NULL REFERENCES budget_reservation(reservation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  budget_receipt_json TEXT NOT NULL CHECK (json_valid(budget_receipt_json) AND json_type(budget_receipt_json) = 'object'),
  budget_receipt_hash TEXT NOT NULL CHECK (length(budget_receipt_hash) = 64 AND budget_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  release_sha256 TEXT NOT NULL CHECK (length(release_sha256) = 64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  response_sha256 TEXT CHECK (response_sha256 IS NULL OR (length(response_sha256) = 64 AND response_sha256 NOT GLOB '*[^0-9a-f]*')),
  external_calls INTEGER NOT NULL CHECK (external_calls IN (0, 1)),
  reason_code TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  UNIQUE (slot_id, attempt_number),
  CHECK ((attempt_state = 'response_committed' AND response_sha256 IS NOT NULL) OR attempt_state <> 'response_committed')
) STRICT;

CREATE TABLE bilingual_language_slot_draft_v1 (
  draft_id TEXT PRIMARY KEY CHECK (length(CAST(draft_id AS BLOB)) BETWEEN 1 AND 256),
  slot_id TEXT NOT NULL REFERENCES bilingual_language_slot_v1(slot_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES internal_external_attempt(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  model_receipt_id TEXT NOT NULL REFERENCES bilingual_model_receipt_v1(receipt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en')),
  slot_revision INTEGER NOT NULL CHECK (slot_revision >= 0),
  draft_hash TEXT NOT NULL UNIQUE CHECK (length(draft_hash) = 64 AND draft_hash NOT GLOB '*[^0-9a-f]*'),
  output_json TEXT NOT NULL CHECK (json_valid(output_json) AND json_type(output_json) = 'object' AND length(CAST(output_json AS BLOB)) BETWEEN 2 AND 131072),
  input_content_hash TEXT NOT NULL CHECK (length(input_content_hash) = 64 AND input_content_hash NOT GLOB '*[^0-9a-f]*'),
  source_fact_set_hash TEXT NOT NULL CHECK (length(source_fact_set_hash) = 64 AND source_fact_set_hash NOT GLOB '*[^0-9a-f]*'),
  source_release_hash TEXT NOT NULL CHECK (length(source_release_hash) = 64 AND source_release_hash NOT GLOB '*[^0-9a-f]*'),
  prompt_schema_version TEXT NOT NULL CHECK (length(prompt_schema_version) BETWEEN 1 AND 80),
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*'),
  model_route_receipt_hash TEXT NOT NULL CHECK (length(model_route_receipt_hash) = 64 AND model_route_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  copy_risk_status TEXT NOT NULL CHECK (copy_risk_status IN ('screen_passed', 'blocked')),
  rights_status TEXT NOT NULL CHECK (rights_status IN ('clear', 'blocked')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  CHECK (json_extract(output_json, '$.schemaVersion') = 'bilingual-slot-draft-v1'),
  CHECK (json_extract(output_json, '$.language') = language),
  CHECK (json_type(output_json, '$.title') = 'text' AND length(trim(json_extract(output_json, '$.title'))) BETWEEN 1 AND 400),
  CHECK (json_type(output_json, '$.summary') = 'text' AND length(trim(json_extract(output_json, '$.summary'))) BETWEEN 1 AND 1200),
  CHECK (json_type(output_json, '$.lead') = 'text' AND length(trim(json_extract(output_json, '$.lead'))) BETWEEN 1 AND 600),
  CHECK (json_type(output_json, '$.body') = 'array' AND json_array_length(output_json, '$.body') BETWEEN 1 AND 8),
  CHECK (json_type(output_json, '$.keyPoints') = 'array' AND json_array_length(output_json, '$.keyPoints') BETWEEN 1 AND 8),
  CHECK (json_type(output_json, '$.contentHash') = 'text' AND length(json_extract(output_json, '$.contentHash')) = 64 AND json_extract(output_json, '$.contentHash') NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TABLE bilingual_bundle_v1 (
  bundle_id TEXT PRIMARY KEY CHECK (length(CAST(bundle_id AS BLOB)) BETWEEN 1 AND 256),
  candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL CHECK (length(CAST(public_id AS BLOB)) BETWEEN 1 AND 256),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  state TEXT NOT NULL CHECK (state IN ('draft', 'reviewable', 'superseded')),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  input_content_hash TEXT NOT NULL CHECK (length(input_content_hash) = 64 AND input_content_hash NOT GLOB '*[^0-9a-f]*'),
  source_fact_set_hash TEXT NOT NULL CHECK (length(source_fact_set_hash) = 64 AND source_fact_set_hash NOT GLOB '*[^0-9a-f]*'),
  source_release_hash TEXT NOT NULL CHECK (length(source_release_hash) = 64 AND source_release_hash NOT GLOB '*[^0-9a-f]*'),
  prompt_schema_version TEXT NOT NULL CHECK (length(prompt_schema_version) BETWEEN 1 AND 80),
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*'),
  zh_slot_id TEXT NOT NULL REFERENCES bilingual_language_slot_v1(slot_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  zh_slot_revision INTEGER NOT NULL CHECK (zh_slot_revision >= 0),
  zh_draft_hash TEXT NOT NULL CHECK (length(zh_draft_hash) = 64 AND zh_draft_hash NOT GLOB '*[^0-9a-f]*'),
  zh_model_route_receipt_hash TEXT NOT NULL CHECK (length(zh_model_route_receipt_hash) = 64 AND zh_model_route_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  en_slot_id TEXT NOT NULL REFERENCES bilingual_language_slot_v1(slot_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  en_slot_revision INTEGER NOT NULL CHECK (en_slot_revision >= 0),
  en_draft_hash TEXT NOT NULL CHECK (length(en_draft_hash) = 64 AND en_draft_hash NOT GLOB '*[^0-9a-f]*'),
  en_model_route_receipt_hash TEXT NOT NULL CHECK (length(en_model_route_receipt_hash) = 64 AND en_model_route_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL UNIQUE CHECK (length(bundle_hash) = 64 AND bundle_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object' AND length(CAST(payload_json AS BLOB)) BETWEEN 2 AND 262144),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  UNIQUE (candidate_id, revision),
  UNIQUE (public_id, revision)
) STRICT;

CREATE TABLE bilingual_approval_v1 (
  approval_id TEXT PRIMARY KEY CHECK (length(CAST(approval_id AS BLOB)) BETWEEN 1 AND 256),
  bundle_id TEXT NOT NULL REFERENCES bilingual_bundle_v1(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 64 AND bundle_hash NOT GLOB '*[^0-9a-f]*'),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'manual_override', 'superseded')),
  actor_ref TEXT NOT NULL CHECK (length(CAST(actor_ref AS BLOB)) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  decided_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) = decided_at),
  reason_code TEXT,
  UNIQUE (bundle_id, decision)
) STRICT;

CREATE TABLE bilingual_publication_v1 (
  publication_id TEXT PRIMARY KEY CHECK (length(CAST(publication_id AS BLOB)) BETWEEN 1 AND 256),
  public_id TEXT NOT NULL CHECK (length(CAST(public_id AS BLOB)) BETWEEN 1 AND 256),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('initial', 'correction', 'withdrawal')),
  supersedes_publication_id TEXT REFERENCES bilingual_publication_v1(publication_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_id TEXT NOT NULL REFERENCES bilingual_bundle_v1(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 64 AND bundle_hash NOT GLOB '*[^0-9a-f]*'),
  approval_id TEXT NOT NULL REFERENCES bilingual_approval_v1(approval_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  approval_hash TEXT NOT NULL CHECK (length(approval_hash) = 64 AND approval_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'publishing', 'published', 'reconcile_required', 'failed', 'correction_queued', 'withdrawal_queued', 'withdrawn')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  reason_code TEXT CHECK (reason_code IS NULL OR length(trim(reason_code)) BETWEEN 1 AND 120),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  published_at TEXT CHECK (published_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', published_at) = published_at),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  UNIQUE (public_id, revision),
  CHECK ((change_kind = 'initial' AND revision = 1 AND supersedes_publication_id IS NULL AND reason_code IS NULL)
      OR (change_kind = 'correction' AND revision >= 2 AND supersedes_publication_id IS NOT NULL AND reason_code IS NOT NULL)
      OR (change_kind = 'withdrawal' AND revision >= 2 AND supersedes_publication_id IS NOT NULL AND reason_code IS NOT NULL)),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
) STRICT;

CREATE TABLE bilingual_public_projection_v1 (
  projection_id TEXT PRIMARY KEY CHECK (length(CAST(projection_id AS BLOB)) BETWEEN 1 AND 256),
  publication_id TEXT NOT NULL REFERENCES bilingual_publication_v1(publication_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL CHECK (length(CAST(public_id AS BLOB)) BETWEEN 1 AND 256),
  generation_id TEXT NOT NULL CHECK (length(CAST(generation_id AS BLOB)) BETWEEN 1 AND 256),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  schema_version TEXT NOT NULL CHECK (schema_version = 'public-read-bilingual-v2'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object' AND length(CAST(payload_json AS BLOB)) BETWEEN 2 AND 524288),
  payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  signature TEXT NOT NULL CHECK (length(CAST(signature AS BLOB)) BETWEEN 1 AND 4096),
  release_sha256 TEXT NOT NULL CHECK (length(release_sha256) = 64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'superseded', 'withdrawn', 'invalid')),
  version INTEGER NOT NULL CHECK (version >= 1),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE bilingual_public_projection_active_v1 (
  public_id TEXT PRIMARY KEY CHECK (length(CAST(public_id AS BLOB)) BETWEEN 1 AND 256),
  projection_id TEXT NOT NULL UNIQUE REFERENCES bilingual_public_projection_v1(projection_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  schema_version TEXT NOT NULL CHECK (schema_version = 'public-read-bilingual-v2'),
  release_sha256 TEXT NOT NULL CHECK (length(release_sha256) = 64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64 AND projection_hash NOT GLOB '*[^0-9a-f]*'),
  pointer_version INTEGER NOT NULL CHECK (pointer_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at)
) STRICT;

CREATE TABLE bilingual_publication_outbox_v1 (
  delivery_id TEXT PRIMARY KEY CHECK (length(CAST(delivery_id AS BLOB)) BETWEEN 1 AND 256),
  publication_id TEXT NOT NULL REFERENCES bilingual_publication_v1(publication_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  projection_id TEXT NOT NULL REFERENCES bilingual_public_projection_v1(projection_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  generation_hash TEXT NOT NULL CHECK (length(generation_hash) = 64 AND generation_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  reconcile_key TEXT NOT NULL UNIQUE CHECK (length(CAST(reconcile_key AS BLOB)) BETWEEN 1 AND 256),
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'succeeded', 'reconcile_required', 'failed', 'cancelled')),
  version INTEGER NOT NULL CHECK (version >= 1),
  attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 20),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  lease_token TEXT CHECK (lease_token IS NULL OR length(CAST(lease_token AS BLOB)) = 43),
  lease_expires_at TEXT CHECK (lease_expires_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', lease_expires_at) = lease_expires_at),
  reconcile_consumed_at TEXT CHECK (reconcile_consumed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', reconcile_consumed_at) = reconcile_consumed_at),
  last_reason_code TEXT,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  UNIQUE (publication_id, generation),
  CHECK (attempt_count <= max_attempts),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state <> 'leased' OR lease_expires_at > updated_at),
  CHECK (reconcile_consumed_at IS NULL OR state IN ('succeeded', 'failed', 'cancelled'))
) STRICT;

CREATE INDEX bilingual_slot_state_idx ON bilingual_language_slot_v1(state, updated_at, slot_id);
CREATE INDEX bilingual_receipt_state_idx ON bilingual_model_receipt_v1(attempt_state, created_at, receipt_id);
CREATE INDEX bilingual_bundle_candidate_idx ON bilingual_bundle_v1(candidate_id, revision DESC);
CREATE INDEX bilingual_publication_state_idx ON bilingual_publication_v1(status, updated_at, public_id);
CREATE INDEX bilingual_outbox_state_idx ON bilingual_publication_outbox_v1(state, updated_at, delivery_id);

-- Every mutable 0009 row is closed until an authority successor enables the
-- capability and supplies the matching operation link.  This is intentional:
-- it prevents a repository, fixture, or raw SQL caller from becoming a second
-- writer while 0007's closed authorizer set is unchanged.
CREATE TRIGGER bilingual_lineage_insert_guard
BEFORE INSERT ON bilingual_candidate_lineage_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.semantic_action = 'create_lineage' AND op.state = 'attempt_committed'
) OR NEW.copy_risk_status <> 'unknown' OR NEW.rights_status <> 'unknown'
  OR NEW.deletion_status <> 'unknown' OR NEW.media_status <> 'unknown'
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_lineage_transition_guard
BEFORE UPDATE ON bilingual_candidate_lineage_v1
WHEN NEW.candidate_id <> OLD.candidate_id OR NEW.public_id <> OLD.public_id OR NEW.source_id <> OLD.source_id
  OR NEW.operation_id = OLD.operation_id OR NEW.created_at <> OLD.created_at OR NEW.updated_at <= OLD.updated_at
  OR NOT (
    (NEW.source_revision = OLD.source_revision + 1
      AND (NEW.input_content_hash <> OLD.input_content_hash OR NEW.source_fact_set_hash <> OLD.source_fact_set_hash OR NEW.source_release_hash <> OLD.source_release_hash)
      AND NEW.copy_risk_status = 'unknown' AND NEW.rights_status = 'unknown'
      AND NEW.deletion_status = 'unknown' AND NEW.media_status = 'unknown'
      AND EXISTS (
        SELECT 1 FROM bilingual_operation_link_v1 link
        JOIN internal_operation op ON op.operation_id = link.operation_id
        WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
          AND link.semantic_action = 'refresh_lineage' AND op.state = 'authorized'
          AND op.owner_process = 'bilingual_refiner'
      ))
    OR
    (NEW.source_revision = OLD.source_revision
      AND NEW.input_content_hash = OLD.input_content_hash
      AND NEW.source_fact_set_hash = OLD.source_fact_set_hash
      AND NEW.source_release_hash = OLD.source_release_hash
      AND EXISTS (
        SELECT 1 FROM bilingual_lineage_safety_decision_v1 decision
        JOIN bilingual_operation_link_v1 link ON link.operation_id = decision.operation_id
        JOIN internal_operation op ON op.operation_id = decision.operation_id
        WHERE decision.operation_id = NEW.operation_id AND decision.candidate_id = NEW.candidate_id
          AND decision.source_id = NEW.source_id AND decision.source_revision = NEW.source_revision
          AND decision.input_content_hash = NEW.input_content_hash
          AND decision.copy_risk_status = NEW.copy_risk_status AND decision.rights_status = NEW.rights_status
          AND decision.deletion_status = NEW.deletion_status AND decision.media_status = NEW.media_status
          AND decision.decided_at = NEW.updated_at
          AND link.candidate_id = NEW.candidate_id AND link.semantic_action = 'decide_safety'
          AND op.state = 'authorized' AND op.owner_process = 'admin_http'
      ))
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_LINEAGE_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_lineage_no_delete
BEFORE DELETE ON bilingual_candidate_lineage_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_LINEAGE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_lineage_safety_decision_insert_guard
BEFORE INSERT ON bilingual_lineage_safety_decision_v1
WHEN NOT EXISTS (
    SELECT 1 FROM bilingual_authority_capability_v1
    WHERE capability_id = 'bilingual-v1' AND enabled = 1 AND status = 'enabled'
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_authority_bridge_marker_v1 marker
    WHERE marker.action = 'enable' AND marker.consumed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bilingual_authority_bridge_marker_v1 later
        WHERE later.created_at > marker.created_at AND later.action = 'close' AND later.consumed_at IS NOT NULL
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_candidate_lineage_v1 lineage
    JOIN pending_review_candidate candidate ON candidate.candidate_id = lineage.candidate_id
    JOIN source_registry_v1 registry ON registry.source_id = lineage.source_id
    JOIN source_registry_rss_config_v1 config ON config.source_id = lineage.source_id
    JOIN internal_control control ON control.singleton_id = 1
    WHERE lineage.candidate_id = NEW.candidate_id AND lineage.source_id = NEW.source_id
      AND lineage.source_revision = NEW.source_revision AND lineage.input_content_hash = NEW.input_content_hash
      AND candidate.source_id = NEW.source_id AND candidate.source_revision = NEW.source_revision
      AND candidate.source_payload_hash = NEW.input_content_hash
      AND registry.revision = NEW.source_registry_revision AND registry.identity_sha256 = NEW.source_identity_sha256
      AND registry.source_config_epoch = NEW.source_config_epoch AND registry.source_safety_epoch = NEW.source_safety_epoch
      AND registry.authorization_version = NEW.authorization_version AND registry.policy_epoch = NEW.policy_epoch
      AND registry.recovery_epoch = NEW.recovery_epoch AND registry.authorization_expires_at IS NEW.source_authorization_expires_at
      AND registry.enabled = 1 AND registry.lifecycle_status = 'active' AND registry.source_kind = 'rss' AND registry.collection_mode = 'rss'
      AND registry.normalization_status = 'valid' AND registry.dedup_status IN ('unique', 'linked_existing')
      AND registry.adapter_status = 'ready'
      AND registry.adapter_authorization_status = 'valid' AND registry.platform_allowed = 'allowed' AND registry.source_stop_status = 'clear'
      AND (registry.authorization_expires_at IS NULL OR registry.authorization_expires_at > NEW.decided_at)
      AND config.source_revision = NEW.source_config_revision
      AND config.authorization_receipt_sha256 = NEW.source_authorization_receipt_sha256
      AND config.source_policy_sha256 = NEW.source_policy_sha256
      AND control.source_config_epoch = NEW.control_source_config_epoch AND control.source_safety_epoch = NEW.control_source_safety_epoch
      AND control.authorization_version = NEW.control_authorization_version AND control.policy_epoch = NEW.control_policy_epoch
      AND control.recovery_epoch = NEW.control_recovery_epoch AND control.writer_epoch = NEW.writer_epoch
  )
  OR NOT EXISTS (
    SELECT 1 FROM internal_operation op
    JOIN bilingual_operation_link_v1 link ON link.operation_id = op.operation_id
    JOIN operation_entity_binding source_binding ON source_binding.operation_id = op.operation_id
      AND source_binding.entity_kind = 'source' AND source_binding.entity_id = NEW.source_id
      AND source_binding.identity_selector = 'source_id'
    JOIN operation_entity_binding candidate_binding ON candidate_binding.operation_id = op.operation_id
      AND candidate_binding.entity_kind = 'candidate' AND candidate_binding.entity_id = NEW.candidate_id
      AND candidate_binding.identity_selector = 'candidate_id'
    JOIN gateway_write_permit permit ON permit.operation_id = op.operation_id
      AND permit.entity_kind = 'candidate' AND permit.entity_id = NEW.candidate_id
      AND permit.mutation_kind = 'update' AND permit.expected_entity_version = NEW.source_revision
      AND permit.expected_entity_hash = NEW.input_content_hash AND permit.consumed_at IS NULL
    WHERE op.operation_id = NEW.operation_id AND op.state = 'authorized'
      AND op.owner_process = 'admin_http' AND op.operation_kind = 'review'
      AND op.capability_class = 'db_mutation' AND op.egress_class = 'none'
      AND op.policy_id = 'p-review-admin-' || op.phase
      AND op.candidate_id = NEW.candidate_id AND op.source_id = NEW.source_id
      AND op.expected_entity_version = NEW.source_revision AND op.expected_entity_hash = NEW.input_content_hash
      AND op.request_hash = NEW.request_hash
      AND link.candidate_id = NEW.candidate_id AND link.semantic_action = 'decide_safety'
      AND link.request_hash = NEW.request_hash
  )
  OR (NEW.supersedes_decision_id IS NULL AND EXISTS (
      SELECT 1 FROM bilingual_lineage_safety_decision_v1 WHERE candidate_id = NEW.candidate_id
    ))
  OR (NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bilingual_lineage_safety_decision_v1 previous
      WHERE previous.decision_id = NEW.supersedes_decision_id AND previous.candidate_id = NEW.candidate_id
        AND previous.decision_seq = NEW.decision_seq - 1
        AND NOT EXISTS (
          SELECT 1 FROM bilingual_lineage_safety_decision_v1 later
          WHERE later.candidate_id = previous.candidate_id AND later.decision_seq > previous.decision_seq
        )
    ))
  OR (NEW.decision_seq <> 1 AND NEW.supersedes_decision_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_INVALID'); END;

CREATE TRIGGER bilingual_lineage_safety_decision_apply
AFTER INSERT ON bilingual_lineage_safety_decision_v1
BEGIN
  UPDATE gateway_write_permit SET consumed_at = NEW.decided_at
  WHERE operation_id = NEW.operation_id AND entity_kind = 'candidate' AND entity_id = NEW.candidate_id
    AND mutation_kind = 'update' AND consumed_at IS NULL;
  UPDATE bilingual_candidate_lineage_v1
  SET copy_risk_status = NEW.copy_risk_status, rights_status = NEW.rights_status,
      deletion_status = NEW.deletion_status, media_status = NEW.media_status,
      operation_id = NEW.operation_id, updated_at = NEW.decided_at
  WHERE candidate_id = NEW.candidate_id AND source_revision = NEW.source_revision
    AND input_content_hash = NEW.input_content_hash;
END;

CREATE TRIGGER bilingual_lineage_safety_decision_no_update
BEFORE UPDATE ON bilingual_lineage_safety_decision_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_IMMUTABLE'); END;
CREATE TRIGGER bilingual_lineage_safety_decision_no_delete
BEFORE DELETE ON bilingual_lineage_safety_decision_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_operation_link_insert_guard
BEFORE INSERT ON bilingual_operation_link_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM internal_operation op
  WHERE op.operation_id = NEW.operation_id AND op.state IN ('requested', 'authorized', 'attempt_committed')
    AND op.operation_kind IN ('refine', 'review', 'publish', 'projection', 'backfill', 'withdraw')
    AND op.owner_process NOT IN ('automatic_reviewer', 'automatic_publisher')
)
  OR NOT EXISTS (SELECT 1 FROM internal_operation op WHERE op.operation_id = NEW.operation_id AND op.request_hash = NEW.request_hash)
  OR (NEW.semantic_action IN ('create_lineage', 'refresh_lineage', 'refine_both', 'refine_language', 'retry_language', 'rerun_language', 'create_bundle')
    AND NOT EXISTS (
      SELECT 1 FROM internal_operation op
      WHERE op.operation_id = NEW.operation_id AND op.operation_kind = 'refine'
        AND op.owner_process = 'bilingual_refiner' AND op.capability_class = 'external_attempt'
        AND op.state = 'attempt_committed' AND op.attempt = NEW.attempt_number
    ))
  OR NEW.parent_operation_id = NEW.operation_id
  OR (NEW.semantic_action = 'refine_both' AND EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 child
    WHERE child.operation_id = NEW.operation_id AND child.parent_operation_id IS NOT NULL
      AND child.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
  ))
  OR (NEW.semantic_action = 'refine_both' AND (
    (NEW.attempt_number = 1 AND EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 prior
      WHERE prior.candidate_id = NEW.candidate_id AND prior.semantic_action = 'refine_both'
    ))
    OR (NEW.attempt_number > 1 AND NOT EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 prior
      JOIN internal_operation prior_op ON prior_op.operation_id = prior.operation_id
      JOIN internal_operation current_op ON current_op.operation_id = NEW.operation_id
      JOIN bilingual_operation_link_v1 prior_zh ON prior_zh.operation_id = prior.operation_id
      WHERE prior.candidate_id = NEW.candidate_id AND prior.semantic_action = 'refine_both'
        AND prior.parent_operation_id IS NULL AND prior.language IS NULL
        AND prior.attempt_number = NEW.attempt_number - 1
        AND prior_op.state IN ('succeeded', 'terminal_failed')
        AND prior_zh.candidate_id = prior.candidate_id AND prior_zh.parent_operation_id IS NULL
        AND prior_zh.language = 'zh-CN' AND prior_zh.attempt_number = prior.attempt_number
        AND prior_zh.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
        AND prior_op.source_id = current_op.source_id
        AND prior_op.candidate_id = current_op.candidate_id
        AND prior_op.expected_entity_version = current_op.expected_entity_version
        AND prior_op.expected_entity_hash = current_op.expected_entity_hash
    ))
  ))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND (
    (NEW.attempt_number = 1 AND NEW.semantic_action <> 'refine_language')
    OR (NEW.attempt_number > 1 AND (
      NEW.semantic_action NOT IN ('retry_language', 'rerun_language')
      OR NOT EXISTS (
        SELECT 1 FROM bilingual_operation_link_v1 prior_language
        JOIN internal_operation prior_op ON prior_op.operation_id = prior_language.operation_id
        JOIN internal_operation current_op ON current_op.operation_id = NEW.operation_id
        WHERE prior_language.candidate_id = NEW.candidate_id
          AND prior_language.language = NEW.language
          AND prior_language.attempt_number = NEW.attempt_number - 1
          AND prior_language.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
          AND prior_op.state IN ('succeeded', 'terminal_failed', 'blocked')
          AND prior_op.candidate_id = current_op.candidate_id
          AND prior_op.source_id = current_op.source_id
          AND prior_op.expected_entity_version = current_op.expected_entity_version
          AND prior_op.expected_entity_hash = current_op.expected_entity_hash
      )
    ))
  ))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.parent_operation_id IS NULL
    AND NOT (NEW.language = 'zh-CN' AND EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 carrier
      WHERE carrier.operation_id = NEW.operation_id AND carrier.parent_operation_id IS NULL
        AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
        AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number = NEW.attempt_number
    )))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.language = 'zh-CN' AND NEW.parent_operation_id IS NOT NULL)
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.parent_operation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 carrier
      JOIN internal_operation carrier_op ON carrier_op.operation_id = carrier.operation_id
      JOIN internal_operation child_op ON child_op.operation_id = NEW.operation_id
      JOIN bilingual_operation_link_v1 zh_link ON zh_link.operation_id = carrier.operation_id
      WHERE NEW.language = 'en' AND carrier.operation_id = NEW.parent_operation_id AND carrier.parent_operation_id IS NULL
        AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
        AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number <= NEW.attempt_number
        AND zh_link.candidate_id = carrier.candidate_id AND zh_link.parent_operation_id IS NULL
        AND zh_link.language = 'zh-CN' AND zh_link.attempt_number = carrier.attempt_number
        AND zh_link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
        AND (carrier_op.state = 'succeeded' OR (carrier_op.state = 'attempt_committed' AND carrier.attempt_number = NEW.attempt_number))
        AND carrier_op.candidate_id = child_op.candidate_id
        AND carrier_op.source_id = child_op.source_id
        AND carrier_op.expected_entity_version = child_op.expected_entity_version
        AND carrier_op.expected_entity_hash = child_op.expected_entity_hash
        AND NOT EXISTS (SELECT 1 FROM bilingual_operation_link_v1 role_conflict
          WHERE role_conflict.operation_id = NEW.operation_id AND role_conflict.semantic_action = 'refine_both')
        AND NOT EXISTS (
          SELECT 1 FROM bilingual_operation_link_v1 later
          JOIN internal_operation later_op ON later_op.operation_id = later.operation_id
          WHERE later.candidate_id = carrier.candidate_id AND later.semantic_action = 'refine_both'
            AND later.parent_operation_id IS NULL AND later.language IS NULL
            AND later.attempt_number > carrier.attempt_number AND later_op.state = 'succeeded'
        )
    ))
  OR (NEW.semantic_action = 'create_bundle' AND NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 carrier
    WHERE carrier.operation_id = NEW.operation_id AND carrier.parent_operation_id IS NULL
      AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
      AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number = NEW.attempt_number
  ))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_operation_link_no_update
BEFORE UPDATE ON bilingual_operation_link_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OPERATION_LINK_IMMUTABLE'); END;
CREATE TRIGGER bilingual_operation_link_no_delete
BEFORE DELETE ON bilingual_operation_link_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OPERATION_LINK_IMMUTABLE'); END;

CREATE TRIGGER bilingual_slot_insert_guard
BEFORE INSERT ON bilingual_language_slot_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.language = NEW.language AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
    AND op.state = 'attempt_committed' AND op.owner_process = 'bilingual_refiner'
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_slot_transition_guard
BEFORE UPDATE ON bilingual_language_slot_v1
WHEN NEW.slot_id <> OLD.slot_id OR NEW.candidate_id <> OLD.candidate_id OR NEW.language <> OLD.language
  OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at <= OLD.updated_at
  OR NEW.source_revision <> OLD.source_revision OR NEW.input_content_hash <> OLD.input_content_hash
  OR NEW.source_fact_set_hash <> OLD.source_fact_set_hash OR NEW.source_release_hash <> OLD.source_release_hash
  OR NEW.prompt_schema_version <> OLD.prompt_schema_version OR NEW.prompt_sha256 <> OLD.prompt_sha256
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link
    JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
      AND link.language = NEW.language AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
      AND op.owner_process = 'bilingual_refiner'
      AND ((NEW.state IN ('queued', 'stale', 'blocked') AND op.state = 'attempt_committed')
        OR (NEW.state = 'running' AND op.state = 'in_flight')
        OR (NEW.state = 'complete' AND op.state = 'succeeded')
        OR (NEW.state = 'failed' AND op.state = 'terminal_failed')
        OR (NEW.state = 'reconcile_required' AND op.state = 'reconcile_required'))
  )
  OR (OLD.state IN ('blocked', 'failed', 'stale', 'complete') AND NEW.state = 'queued' AND NEW.operation_id = OLD.operation_id)
  OR (OLD.state = 'complete' AND NEW.state = 'stale' AND NEW.operation_id = OLD.operation_id)
  OR (NOT ((OLD.state IN ('blocked', 'failed', 'stale', 'complete') AND NEW.state = 'queued') OR (OLD.state = 'complete' AND NEW.state = 'stale')) AND NEW.operation_id <> OLD.operation_id)
  OR (OLD.state IN ('reconcile_required', 'stale') AND NEW.state IN ('running', 'complete', 'failed', 'reconcile_required')
      AND (NEW.operation_id <> OLD.operation_id OR NEW.current_attempt_id IS NOT OLD.current_attempt_id OR NEW.current_attempt_operation_id IS NOT OLD.current_attempt_operation_id))
  OR (OLD.state = 'running' AND (NEW.current_attempt_id IS NOT OLD.current_attempt_id OR NEW.current_attempt_operation_id IS NOT OLD.current_attempt_operation_id))
  OR (NEW.current_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bilingual_model_receipt_v1 WHERE attempt_id = NEW.current_attempt_id AND operation_id = NEW.current_attempt_operation_id AND slot_id = NEW.slot_id AND candidate_id = NEW.candidate_id AND language = NEW.language))
  OR (OLD.state = 'queued' AND NEW.current_attempt_id IS NOT NULL AND NEW.current_attempt_operation_id <> NEW.operation_id)
  OR NOT (
    (OLD.state = 'missing' AND NEW.state = 'queued') OR
    (OLD.state IN ('queued', 'running') AND NEW.state IN ('running', 'complete', 'blocked', 'failed', 'reconcile_required')) OR
    (OLD.state = 'complete' AND NEW.state IN ('stale', 'queued')) OR
    (OLD.state IN ('blocked', 'failed', 'stale') AND NEW.state = 'queued') OR
    (OLD.state = 'stale' AND NEW.state = 'reconcile_required') OR
    (OLD.state = 'reconcile_required' AND NEW.state IN ('running', 'complete', 'failed'))
  )
  OR (NEW.state = 'queued' AND (NEW.current_attempt_id IS NOT NULL OR NEW.current_attempt_operation_id IS NOT NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'running' AND (NEW.current_attempt_id IS NULL OR NEW.current_attempt_operation_id IS NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'complete' AND (NEW.current_attempt_id IS NULL OR NEW.model_route_receipt_hash IS NULL OR NEW.draft_hash IS NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'stale' AND (NEW.current_attempt_id IS NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'reconcile_required' AND NEW.current_attempt_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SLOT_TRANSITION_INVALID'); END;
CREATE TRIGGER bilingual_slot_no_delete
BEFORE DELETE ON bilingual_language_slot_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SLOT_APPEND_ONLY'); END;

CREATE TRIGGER bilingual_receipt_insert_guard
BEFORE INSERT ON bilingual_model_receipt_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.parent_operation_id IS NEW.parent_operation_id AND link.candidate_id = NEW.candidate_id
    AND link.language = NEW.language AND link.attempt_number = NEW.attempt_number AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
    AND op.owner_process = 'bilingual_refiner'
)
  OR NOT EXISTS (
    SELECT 1 FROM internal_external_attempt attempt
    JOIN internal_operation op ON op.operation_id = attempt.operation_id
    WHERE attempt.attempt_id = NEW.attempt_id
      AND attempt.operation_id = NEW.operation_id
      AND attempt.attempt_number = NEW.attempt_number
      AND op.expected_release_sha256 = NEW.release_sha256
      AND op.expected_manifest_sha256 = NEW.manifest_sha256
      AND attempt.route_id = NEW.model_route_ref
      AND attempt.external_calls = NEW.external_calls
      AND attempt.response_hash IS NEW.response_sha256
      AND attempt.state = NEW.attempt_state
      AND ((attempt.state = 'response_committed' AND attempt.outcome = 'succeeded' AND op.state = 'succeeded')
        OR (attempt.state = 'response_committed' AND attempt.outcome = 'known_failed' AND op.state = 'terminal_failed')
        OR (attempt.state = 'reconcile_required' AND attempt.outcome = 'unknown' AND op.state = 'reconcile_required'))
  )
  OR NOT EXISTS (
    SELECT 1 FROM budget_reservation reservation
    WHERE reservation.reservation_id = NEW.budget_reservation_id AND reservation.operation_id = NEW.operation_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_language_slot_v1 slot
    WHERE slot.slot_id = NEW.slot_id AND slot.candidate_id = NEW.candidate_id AND slot.language = NEW.language
      AND slot.prompt_schema_version = NEW.prompt_schema_version AND slot.prompt_sha256 = NEW.prompt_sha256
      AND slot.operation_id = NEW.operation_id
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;
CREATE TRIGGER bilingual_receipt_no_update
BEFORE UPDATE ON bilingual_model_receipt_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_MODEL_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER bilingual_receipt_no_delete
BEFORE DELETE ON bilingual_model_receipt_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_MODEL_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_draft_insert_guard
BEFORE INSERT ON bilingual_language_slot_draft_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = (SELECT operation_id FROM bilingual_model_receipt_v1 WHERE receipt_id = NEW.model_receipt_id)
    AND link.candidate_id = NEW.candidate_id AND link.language = NEW.language
    AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND op.state = 'succeeded'
)
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_model_receipt_v1 receipt
    JOIN internal_external_attempt attempt ON attempt.attempt_id = receipt.attempt_id
    WHERE receipt.receipt_id = NEW.model_receipt_id AND receipt.attempt_id = NEW.attempt_id
      AND receipt.slot_id = NEW.slot_id AND receipt.candidate_id = NEW.candidate_id AND receipt.language = NEW.language
      AND receipt.attempt_state = 'response_committed' AND attempt.outcome = 'succeeded'
  )
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json) WHERE key NOT IN ('schemaVersion', 'language', 'title', 'summary', 'lead', 'body', 'keyPoints', 'contentHash'))
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json, '$.body') WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 12000)
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json, '$.keyPoints') WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 240)
  OR json_type(NEW.output_json, '$.sourceExcerpt') IS NOT NULL
  OR json_type(NEW.output_json, '$.rawSource') IS NOT NULL
  OR json_type(NEW.output_json, '$.sourceBody') IS NOT NULL
  OR json_type(NEW.output_json, '$.rawBody') IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_CONTRACT_INVALID'); END;
CREATE TRIGGER bilingual_draft_no_update
BEFORE UPDATE ON bilingual_language_slot_draft_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_IMMUTABLE'); END;
CREATE TRIGGER bilingual_draft_no_delete
BEFORE DELETE ON bilingual_language_slot_draft_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_bundle_insert_guard
BEFORE INSERT ON bilingual_bundle_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.semantic_action = 'create_bundle' AND link.parent_operation_id IS NULL AND link.language IS NULL
    AND op.state = 'succeeded' AND op.owner_process = 'bilingual_refiner'
)
  OR NEW.zh_slot_id = NEW.en_slot_id
  OR NOT EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE slot_id = NEW.zh_slot_id AND candidate_id = NEW.candidate_id AND language = 'zh-CN' AND revision = NEW.zh_slot_revision AND state = 'complete' AND draft_hash = NEW.zh_draft_hash AND prompt_schema_version = NEW.prompt_schema_version AND prompt_sha256 = NEW.prompt_sha256 AND model_route_receipt_hash = NEW.zh_model_route_receipt_hash)
  OR NOT EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE slot_id = NEW.en_slot_id AND candidate_id = NEW.candidate_id AND language = 'en' AND revision = NEW.en_slot_revision AND state = 'complete' AND draft_hash = NEW.en_draft_hash AND prompt_schema_version = NEW.prompt_schema_version AND prompt_sha256 = NEW.prompt_sha256 AND model_route_receipt_hash = NEW.en_model_route_receipt_hash)
  OR EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE candidate_id = NEW.candidate_id AND language NOT IN ('zh-CN', 'en'))
  OR NOT EXISTS (SELECT 1 FROM bilingual_candidate_lineage_v1 WHERE candidate_id = NEW.candidate_id AND source_revision = NEW.source_revision AND input_content_hash = NEW.input_content_hash AND source_fact_set_hash = NEW.source_fact_set_hash AND source_release_hash = NEW.source_release_hash AND copy_risk_status = 'screen_passed' AND rights_status = 'clear' AND deletion_status = 'clear' AND media_status IN ('none', 'allowed'))
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    WHERE safety.candidate_id = NEW.candidate_id AND safety.source_revision = NEW.source_revision
      AND safety.input_content_hash = NEW.input_content_hash AND safety.action = 'clear'
      AND safety.copy_risk_status = 'screen_passed' AND safety.rights_status = 'clear'
      AND safety.deletion_status = 'clear' AND safety.media_status IN ('none', 'allowed')
      AND safety.expires_at > NEW.created_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.created_at)
      AND json_extract(NEW.payload_json, '$.safetyAuthority.decisionId') = safety.decision_id
      AND json_extract(NEW.payload_json, '$.safetyAuthority.decisionSeq') = safety.decision_seq
      AND json_extract(NEW.payload_json, '$.safetyAuthority.resourceHash') = safety.resource_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.requestHash') = safety.request_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.authorityContextHash') = safety.authority_context_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.expiresAt') = safety.expires_at
  )
  OR EXISTS (SELECT 1 FROM json_tree(NEW.payload_json) WHERE key IN ('sourceExcerpt', 'rawSource', 'sourceBody', 'rawBody', 'prompt', 'modelResponse', 'privateRouteReceipt'))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_GATE_BLOCKED'); END;
CREATE TRIGGER bilingual_bundle_no_update
BEFORE UPDATE ON bilingual_bundle_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_bundle_no_delete
BEFORE DELETE ON bilingual_bundle_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_approval_insert_guard
BEFORE INSERT ON bilingual_approval_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action IN ('approve', 'reject')
    AND link.candidate_id = (SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id AND bundle_hash = NEW.bundle_hash AND state = 'reviewable')
  OR (NEW.decision IN ('approved', 'manual_override') AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.decided_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.decided_at)
  ))
  OR NEW.actor_ref LIKE 'system-%'
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_REVIEW_MANUAL_ONLY'); END;
CREATE TRIGGER bilingual_approval_no_update
BEFORE UPDATE ON bilingual_approval_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER bilingual_approval_no_delete
BEFORE DELETE ON bilingual_approval_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_APPROVAL_IMMUTABLE'); END;

CREATE TRIGGER bilingual_publication_insert_guard
BEFORE INSERT ON bilingual_publication_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id
    AND link.semantic_action = CASE NEW.change_kind WHEN 'initial' THEN 'publish' WHEN 'correction' THEN 'correct' ELSE 'withdraw' END
    AND link.candidate_id = (SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_approval_v1 WHERE approval_id = NEW.approval_id AND bundle_id = NEW.bundle_id AND bundle_hash = NEW.bundle_hash AND decision IN ('approved', 'manual_override'))
  OR EXISTS (SELECT 1 FROM bilingual_approval_v1 a WHERE a.bundle_id = NEW.bundle_id AND a.decision = 'superseded')
  OR (NEW.change_kind <> 'withdrawal' AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.created_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.created_at)
  ))
  OR NEW.status <> CASE NEW.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END
  OR NEW.published_at IS NOT NULL OR NEW.updated_at <> NEW.created_at
  OR (NEW.change_kind = 'initial' AND (NEW.revision <> 1 OR NEW.supersedes_publication_id IS NOT NULL))
  OR (NEW.change_kind IN ('correction', 'withdrawal') AND NOT EXISTS (
    SELECT 1 FROM bilingual_publication_v1 previous
    WHERE previous.publication_id = NEW.supersedes_publication_id AND previous.public_id = NEW.public_id
      AND previous.status = 'published' AND NEW.revision = previous.revision + 1
      AND NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 newer WHERE newer.public_id = previous.public_id AND newer.revision > previous.revision)
      AND ((NEW.change_kind = 'correction' AND (NEW.bundle_id <> previous.bundle_id OR NEW.bundle_hash <> previous.bundle_hash))
        OR (NEW.change_kind = 'withdrawal' AND NEW.bundle_id = previous.bundle_id AND NEW.bundle_hash = previous.bundle_hash
          AND NEW.approval_id = previous.approval_id AND NEW.approval_hash = previous.approval_hash))
  ))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_MANUAL_ONLY'); END;
CREATE TRIGGER bilingual_publication_transition_guard
BEFORE UPDATE ON bilingual_publication_v1
WHEN NEW.publication_id <> OLD.publication_id OR NEW.public_id <> OLD.public_id OR NEW.revision <> OLD.revision
  OR NEW.change_kind <> OLD.change_kind OR NEW.supersedes_publication_id IS NOT OLD.supersedes_publication_id
  OR NEW.bundle_id <> OLD.bundle_id OR NEW.bundle_hash <> OLD.bundle_hash OR NEW.approval_id <> OLD.approval_id
  OR NEW.approval_hash <> OLD.approval_hash OR NEW.payload_hash <> OLD.payload_hash OR NEW.reason_code IS NOT OLD.reason_code
  OR NEW.created_at <> OLD.created_at OR NEW.updated_at <= OLD.updated_at
  OR (NEW.change_kind <> 'withdrawal' AND NEW.status IN ('publishing', 'published') AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.updated_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.updated_at)
  ))
  OR (NEW.operation_id <> OLD.operation_id AND NOT (OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END))
  OR (NEW.operation_id = OLD.operation_id AND OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END)
  OR (NEW.published_at IS NOT OLD.published_at AND NOT (OLD.published_at IS NULL AND NEW.status = 'published' AND NEW.published_at IS NOT NULL))
  OR NOT ((OLD.status = 'queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'publishing' AND NEW.status IN ('published', 'withdrawn', 'reconcile_required', 'failed'))
      OR (OLD.status = 'reconcile_required' AND NEW.status IN ('published', 'withdrawn', 'failed'))
      OR (OLD.status = 'correction_queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'withdrawal_queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END))
  OR (OLD.status = 'failed' AND NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id=link.operation_id
    WHERE link.operation_id=NEW.operation_id
      AND link.semantic_action=CASE OLD.change_kind WHEN 'initial' THEN 'publish' WHEN 'correction' THEN 'correct' ELSE 'withdraw' END
      AND link.candidate_id=(SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id=NEW.bundle_id)
      AND op.state='authorized' AND op.owner_process='admin_http'
  ))
  OR (NEW.status = 'published' AND OLD.change_kind = 'withdrawal')
  OR (NEW.status = 'withdrawn' AND OLD.change_kind <> 'withdrawal')
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_TRANSITION_INVALID'); END;
CREATE TRIGGER bilingual_publication_no_delete
BEFORE DELETE ON bilingual_publication_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_projection_insert_guard
BEFORE INSERT ON bilingual_public_projection_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'create_projection'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id = b.bundle_id WHERE p.publication_id = NEW.publication_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id AND public_id = NEW.public_id AND status IN ('published', 'withdrawn'))
  OR EXISTS (SELECT 1 FROM json_tree(NEW.payload_json) WHERE key IN ('sourceExcerpt', 'rawSource', 'sourceBody', 'rawBody', 'prompt', 'modelResponse', 'privateRouteReceipt'))
  OR json_extract(NEW.payload_json, '$.schemaVersion') <> 'public-read-bilingual-v2'
  OR NEW.version <> 1 OR NEW.updated_at <> NEW.created_at
  OR NEW.status <> CASE (SELECT status FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id)
      WHEN 'published' THEN 'staged' ELSE 'withdrawn' END
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_GATE_BLOCKED'); END;
CREATE TRIGGER bilingual_projection_transition_guard
BEFORE UPDATE ON bilingual_public_projection_v1
WHEN NEW.projection_id <> OLD.projection_id OR NEW.publication_id <> OLD.publication_id OR NEW.public_id <> OLD.public_id
  OR NEW.generation_id <> OLD.generation_id OR NEW.generation <> OLD.generation OR NEW.schema_version <> OLD.schema_version
  OR NEW.payload_json <> OLD.payload_json OR NEW.payload_hash <> OLD.payload_hash OR NEW.signature <> OLD.signature
  OR NEW.release_sha256 <> OLD.release_sha256 OR NEW.manifest_sha256 <> OLD.manifest_sha256
  OR NEW.version <> OLD.version + 1 OR NEW.operation_id = OLD.operation_id OR NEW.created_at <> OLD.created_at
  OR NEW.updated_at <= OLD.updated_at
  OR NOT ((OLD.status = 'staged' AND NEW.status IN ('active', 'invalid', 'superseded'))
      OR (OLD.status = 'active' AND NEW.status IN ('superseded', 'withdrawn', 'invalid')))
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_receiver')
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_TRANSITION_INVALID'); END;
CREATE TRIGGER bilingual_projection_no_delete
BEFORE DELETE ON bilingual_public_projection_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_active_pointer_insert_guard
BEFORE INSERT ON bilingual_public_projection_active_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NEW.pointer_version <> 1
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND public_id = NEW.public_id AND generation = NEW.generation AND schema_version = NEW.schema_version AND release_sha256 = NEW.release_sha256 AND manifest_sha256 = NEW.manifest_sha256 AND payload_hash = NEW.projection_hash AND ((NEW.status = 'withdrawn' AND status = 'withdrawn') OR (NEW.status = 'active' AND status = 'active')))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_CLOSED'); END;
CREATE TRIGGER bilingual_active_pointer_transition_guard
BEFORE UPDATE ON bilingual_public_projection_active_v1
WHEN NEW.public_id <> OLD.public_id OR NEW.projection_id = OLD.projection_id
  OR NEW.generation <= OLD.generation OR NEW.projection_hash = OLD.projection_hash
  OR NEW.schema_version <> OLD.schema_version OR NEW.release_sha256 <> OLD.release_sha256 OR NEW.manifest_sha256 <> OLD.manifest_sha256
  OR NEW.pointer_version <> OLD.pointer_version + 1 OR NEW.operation_id = OLD.operation_id
  OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_receiver')
  )
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND public_id = NEW.public_id AND generation = NEW.generation AND schema_version = NEW.schema_version AND release_sha256 = NEW.release_sha256 AND manifest_sha256 = NEW.manifest_sha256 AND payload_hash = NEW.projection_hash AND ((NEW.status = 'withdrawn' AND status = 'withdrawn') OR (NEW.status = 'active' AND status = 'active')))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_CAS'); END;
CREATE TRIGGER bilingual_active_pointer_no_delete
BEFORE DELETE ON bilingual_public_projection_active_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_IMMUTABLE'); END;

CREATE TRIGGER bilingual_outbox_insert_guard
BEFORE INSERT ON bilingual_publication_outbox_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'enqueue_delivery'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id WHERE p.publication_id=NEW.publication_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id AND status IN ('published', 'withdrawn'))
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND generation = NEW.generation AND payload_hash = NEW.generation_hash)
  OR NEW.state <> 'pending' OR NEW.version <> 1 OR NEW.attempt_count <> 0
  OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.reconcile_consumed_at IS NOT NULL
  OR NEW.last_reason_code IS NOT NULL OR NEW.updated_at <> NEW.created_at
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_GATE_BLOCKED'); END;
CREATE TRIGGER bilingual_outbox_transition_guard
BEFORE UPDATE ON bilingual_publication_outbox_v1
WHEN NEW.delivery_id <> OLD.delivery_id OR NEW.publication_id <> OLD.publication_id OR NEW.projection_id <> OLD.projection_id
  OR NEW.generation <> OLD.generation OR NEW.generation_hash <> OLD.generation_hash
  OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.reconcile_key <> OLD.reconcile_key
  OR NEW.max_attempts <> OLD.max_attempts OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action IN ('enqueue_delivery', 'reconcile')
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id WHERE p.publication_id=NEW.publication_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_sender', 'projection_receiver', 'reconciler')
  )
  OR NOT (
    (OLD.state = 'pending' AND NEW.state = 'leased' AND NEW.attempt_count = OLD.attempt_count + 1
      AND NEW.lease_token IS NOT NULL AND NEW.lease_expires_at > NEW.updated_at AND NEW.last_reason_code IS NULL
      AND NEW.reconcile_consumed_at IS OLD.reconcile_consumed_at)
    OR (OLD.state = 'pending' AND NEW.state = 'cancelled' AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NOT NULL)
    OR (OLD.state = 'leased' AND NEW.state = 'succeeded' AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NULL)
    OR (OLD.state = 'leased' AND NEW.state IN ('reconcile_required', 'failed') AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NOT NULL)
    OR (OLD.state = 'leased' AND NEW.state = 'pending' AND NEW.updated_at >= OLD.lease_expires_at
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND NEW.last_reason_code IS NOT NULL AND NEW.operation_id <> OLD.operation_id)
    OR (OLD.state = 'reconcile_required' AND NEW.state IN ('succeeded', 'failed', 'cancelled')
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND OLD.reconcile_consumed_at IS NULL AND NEW.reconcile_consumed_at = NEW.updated_at
      AND NEW.operation_id <> OLD.operation_id
      AND ((NEW.state = 'succeeded' AND NEW.last_reason_code IS NULL) OR (NEW.state <> 'succeeded' AND NEW.last_reason_code IS NOT NULL)))
    OR (OLD.state = 'failed' AND NEW.state = 'pending' AND OLD.attempt_count < OLD.max_attempts
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND OLD.reconcile_consumed_at IS NULL AND NEW.reconcile_consumed_at IS NULL AND NEW.last_reason_code IS NULL
      AND NEW.operation_id <> OLD.operation_id)
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_TRANSITION_INVALID'); END;
CREATE TRIGGER bilingual_outbox_no_delete
BEFORE DELETE ON bilingual_publication_outbox_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_IMMUTABLE'); END;

INSERT INTO migration_0009_assert (value)
SELECT CASE WHEN
  (SELECT count(*) FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 0 AND status = 'closed') = 1
  AND (SELECT count(*) FROM bilingual_language_slot_v1) = 0
  AND (SELECT count(*) FROM bilingual_publication_outbox_v1) = 0
  THEN 1 ELSE 0 END;

PRAGMA user_version = 9;
DROP TABLE migration_0009_assert;
COMMIT;
