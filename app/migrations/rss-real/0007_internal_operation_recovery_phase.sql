-- F1+1 migration 0007 frozen candidate. APPLY=false.
-- The opener MUST verify the raw migration SHA-256 and create the connection-local
-- TEMP table below before executing this file:
--   CREATE TEMP TABLE migration_0007_preflight(
--     source_user_version INTEGER NOT NULL,
--     source_schema_sha256 TEXT NOT NULL,
--     migration_sha256 TEXT NOT NULL,
--     apply_enabled INTEGER NOT NULL CHECK(apply_enabled IN (0,1))
--   ) STRICT;
-- Exactly one row is required. apply_enabled=1 is only legal in a separately
-- authorized implementation release. Offline tests use a disposable copy.
-- Migration identity algorithm v1: SHA-256 of the UTF-8 SQL after replacing
-- both lower-hex values tagged MIGRATION_CANONICAL_SHA256 with 64 ASCII zeroes.
-- MIGRATION_CANONICAL_SHA256=d651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0007_assert(value INTEGER NOT NULL CHECK(value=1)) STRICT;
INSERT INTO migration_0007_assert
SELECT
  (SELECT count(*)=1 FROM migration_0007_preflight)
  AND (SELECT source_user_version=6 FROM migration_0007_preflight)
  AND (SELECT source_schema_sha256='396af1d629a1bed95ec846770aaf26a3483d58b4ff28ce9d9f2c876a9987f8a9' FROM migration_0007_preflight)
  AND (SELECT migration_sha256='d651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797' FROM migration_0007_preflight)
  AND (SELECT apply_enabled=1 FROM migration_0007_preflight)
  AND (SELECT user_version=6 FROM pragma_user_version)
  AND NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE name IN (
      'internal_control','internal_operation_policy','internal_control_action_policy','internal_required_fence_policy','owner_authorization_handoff','internal_operation','internal_external_attempt',
      'internal_operation_outbox','internal_operation_audit','gateway_write_permit',
      'route_registry','budget_account','budget_reservation','generic_fence_receipt',
      'operation_entity_binding','operation_fence_binding','backup_recovery_point','projection_recovery_anchor',
      'internal_operation_current_v1','authorized_gateway_write_permit_v1'
    )
  );

CREATE TABLE internal_control (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
  phase TEXT NOT NULL CHECK(phase IN ('disabled','backlog','live','paused')),
  global_stop_state TEXT NOT NULL CHECK(global_stop_state IN ('clear','stopped')),
  emergency_stop_state TEXT NOT NULL CHECK(emergency_stop_state IN ('clear','stopped')),
  recovery_state TEXT NOT NULL CHECK(recovery_state IN ('fenced','restoring','verifying','ready','failed')),
  deletion_fence_state TEXT NOT NULL CHECK(deletion_fence_state IN ('clear','blocked','unknown')),
  publication_fence_state TEXT NOT NULL CHECK(publication_fence_state IN ('clear','blocked','unknown')),
  source_config_epoch INTEGER NOT NULL CHECK(source_config_epoch>=1),
  source_safety_epoch INTEGER NOT NULL CHECK(source_safety_epoch>=1),
  authorization_version INTEGER NOT NULL CHECK(authorization_version>=1),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>=1),
  writer_authority_receipt_sha256 TEXT NOT NULL CHECK(length(writer_authority_receipt_sha256)=64 AND writer_authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  version INTEGER NOT NULL CHECK(version>=1),
  updated_at TEXT NOT NULL,
  updated_by_operation_id TEXT,
  CHECK(recovery_state='ready' OR phase IN ('disabled','paused')),
  CHECK(emergency_stop_state='clear' OR global_stop_state='stopped')
) STRICT;

INSERT INTO internal_control VALUES (
  1,'disabled','stopped','clear','fenced','unknown','blocked',
  1,1,1,1,1,1,'0000000000000000000000000000000000000000000000000000000000000000',
  1,'1970-01-01T00:00:00.000Z',NULL
);

CREATE TABLE internal_operation_policy (
  policy_id TEXT PRIMARY KEY,
  owner_process TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  capability_class TEXT NOT NULL CHECK(capability_class IN ('db_mutation','external_attempt','reconcile_readonly','control','backup','restore')),
  phase TEXT NOT NULL CHECK(phase IN ('disabled','backlog','live','paused')),
  egress_class TEXT NOT NULL CHECK(egress_class IN ('none','rss_https','model_https','projection_private','x_official_https','backup_private')),
  required_identity TEXT NOT NULL CHECK(required_identity IN ('none','source','candidate','publication','source_candidate','publication_public')),
  allow_global_stop INTEGER NOT NULL CHECK(allow_global_stop IN (0,1)),
  allow_emergency_stop INTEGER NOT NULL CHECK(allow_emergency_stop IN (0,1)),
  allowed_recovery_state TEXT NOT NULL CHECK(allowed_recovery_state IN ('ready','not_ready','any')),
  source_fence_mode TEXT NOT NULL CHECK(source_fence_mode IN ('not_applicable','must_clear','quarantine_only')),
  deletion_fence_mode TEXT NOT NULL CHECK(deletion_fence_mode IN ('not_applicable','must_clear','reconcile_only')),
  publication_fence_mode TEXT NOT NULL CHECK(publication_fence_mode IN ('not_applicable','must_clear','reconcile_only')),
  UNIQUE(owner_process,operation_kind,capability_class,phase,egress_class),
  UNIQUE(policy_id,owner_process,operation_kind,capability_class)
) STRICT;

-- This is the complete R3 owner/kind/phase/capability/egress policy. Entity and
-- mutation authority is separately joined through gateway_entity_policy below.
INSERT INTO internal_operation_policy VALUES
('p-collect-disabled','rss_collector','collect','external_attempt','disabled','rss_https','source',0,0,'ready','must_clear','not_applicable','not_applicable'),
('p-collect-live','rss_collector','collect','external_attempt','live','rss_https','source',0,0,'ready','must_clear','not_applicable','not_applicable'),
('p-refine-rss-backlog','rss_refiner','refine','external_attempt','backlog','model_https','source_candidate',0,0,'ready','must_clear','not_applicable','must_clear'),
('p-refine-rss-live','rss_refiner','refine','external_attempt','live','model_https','source_candidate',0,0,'ready','must_clear','not_applicable','must_clear'),
('p-refine-bi-backlog','bilingual_refiner','refine','external_attempt','backlog','model_https','source_candidate',0,0,'ready','must_clear','not_applicable','must_clear'),
('p-refine-bi-live','bilingual_refiner','refine','external_attempt','live','model_https','source_candidate',0,0,'ready','must_clear','not_applicable','must_clear'),
('p-review-auto-backlog','automatic_reviewer','review','db_mutation','backlog','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-review-auto-live','automatic_reviewer','review','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-review-admin-backlog','admin_http','review','db_mutation','backlog','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-review-admin-live','admin_http','review','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-publish-auto-backlog','automatic_publisher','publish','db_mutation','backlog','none','publication_public',0,0,'ready','must_clear','must_clear','must_clear'),
('p-publish-auto-live','automatic_publisher','publish','db_mutation','live','none','publication_public',0,0,'ready','must_clear','must_clear','must_clear'),
('p-publish-admin-backlog','admin_http','publish','db_mutation','backlog','none','publication_public',0,0,'ready','must_clear','must_clear','must_clear'),
('p-publish-admin-live','admin_http','publish','db_mutation','live','none','publication_public',0,0,'ready','must_clear','must_clear','must_clear'),
('p-projection-backlog','projection_sender','projection','external_attempt','backlog','projection_private','publication_public',0,0,'ready','not_applicable','must_clear','must_clear'),
('p-projection-live','projection_sender','projection','external_attempt','live','projection_private','publication_public',0,0,'ready','not_applicable','must_clear','must_clear'),
('p-projection-receiver','projection_receiver','projection','db_mutation','live','none','publication_public',0,0,'ready','not_applicable','must_clear','must_clear'),
('p-backfill-x-live','x_official_adapter','backfill','external_attempt','live','x_official_https','source',0,0,'ready','must_clear','reconcile_only','reconcile_only'),
('p-reconcile-projection-disabled','reconciler','reconcile','reconcile_readonly','disabled','projection_private','publication_public',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-projection-backlog','reconciler','reconcile','reconcile_readonly','backlog','projection_private','publication_public',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-projection-live','reconciler','reconcile','reconcile_readonly','live','projection_private','publication_public',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-projection-paused','reconciler','reconcile','reconcile_readonly','paused','projection_private','publication_public',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-x-disabled','reconciler','reconcile','reconcile_readonly','disabled','x_official_https','source',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-x-backlog','reconciler','reconcile','reconcile_readonly','backlog','x_official_https','source',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-x-live','reconciler','reconcile','reconcile_readonly','live','x_official_https','source',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-reconcile-x-paused','reconciler','reconcile','reconcile_readonly','paused','x_official_https','source',1,1,'any','quarantine_only','reconcile_only','reconcile_only'),
('p-source-create-disabled','admin_http','source_create','control','disabled','none','source',0,0,'ready','must_clear','not_applicable','not_applicable'),
('p-source-update-paused','admin_http','source_update','control','paused','none','source',0,0,'ready','must_clear','not_applicable','not_applicable'),
('p-source-delete-paused','admin_http','source_delete','control','paused','none','source',0,0,'ready','must_clear','must_clear','must_clear'),
('p-phase-control-disabled','admin_http','phase_control','control','disabled','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-phase-control-backlog','admin_http','phase_control','control','backlog','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-phase-control-live','admin_http','phase_control','control','live','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-phase-control-paused','admin_http','phase_control','control','paused','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-system-producer-disabled','admin_telemetry_producer','system_producer','db_mutation','disabled','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-system-producer-backlog','admin_telemetry_producer','system_producer','db_mutation','backlog','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-system-producer-live','admin_telemetry_producer','system_producer','db_mutation','live','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-system-producer-paused','admin_telemetry_producer','system_producer','db_mutation','paused','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-backup-disabled','backup_worker','backup','backup','disabled','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-backup-backlog','backup_worker','backup','backup','backlog','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-backup-live','backup_worker','backup','backup','live','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-backup-paused','backup_worker','backup','backup','paused','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-restore-disabled','restore_operator','restore','restore','disabled','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-restore-paused','restore_operator','restore','restore','paused','backup_private','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-restore-control-disabled','restore_operator','restore','restore','disabled','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-restore-control-paused','restore_operator','restore','restore','paused','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-supervisor-restore-disabled','system_supervisor','restore','restore','disabled','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-supervisor-restore-paused','system_supervisor','restore','restore','paused','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-supervisor-fence-disabled','system_supervisor','system_producer','control','disabled','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-supervisor-fence-paused','system_supervisor','system_producer','control','paused','none','none',1,1,'any','not_applicable','not_applicable','not_applicable'),
('p-withdraw-backlog','admin_http','withdraw','db_mutation','backlog','none','publication_public',0,0,'ready','must_clear','reconcile_only','reconcile_only'),
('p-withdraw-live','admin_http','withdraw','db_mutation','live','none','publication_public',0,0,'ready','must_clear','reconcile_only','reconcile_only'),
('p-withdraw-paused','admin_http','withdraw','db_mutation','paused','none','publication_public',0,0,'ready','must_clear','reconcile_only','reconcile_only');

-- Machine truth for control authority.  An action is authorized only by an
-- exact (policy, owner, operation kind, capability, action) row.  The table is
-- immutable and intentionally contains no admin recovery action.
CREATE TABLE internal_control_action_policy (
  policy_id TEXT NOT NULL REFERENCES internal_operation_policy(policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  owner_process TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  capability_class TEXT NOT NULL,
  control_action TEXT NOT NULL CHECK(control_action IN (
    'enter_backlog','enter_live','pause','disable','set_global_stop','clear_global_stop',
    'set_emergency_stop','clear_emergency_stop','recovery_begin','recovery_advance',
    'recovery_complete','recovery_abort','writer_epoch_bump','fence_update'
  )),
  PRIMARY KEY(policy_id,control_action),
  FOREIGN KEY(policy_id,owner_process,operation_kind,capability_class)
    REFERENCES internal_operation_policy(policy_id,owner_process,operation_kind,capability_class)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;
INSERT INTO internal_control_action_policy VALUES
('p-phase-control-disabled','admin_http','phase_control','control','enter_backlog'),
('p-phase-control-disabled','admin_http','phase_control','control','pause'),
('p-phase-control-disabled','admin_http','phase_control','control','set_global_stop'),
('p-phase-control-disabled','admin_http','phase_control','control','set_emergency_stop'),
('p-phase-control-disabled','admin_http','phase_control','control','clear_emergency_stop'),
('p-phase-control-disabled','admin_http','phase_control','control','clear_global_stop'),
('p-phase-control-disabled','admin_http','phase_control','control','fence_update'),
('p-phase-control-backlog','admin_http','phase_control','control','enter_live'),
('p-phase-control-backlog','admin_http','phase_control','control','pause'),
('p-phase-control-backlog','admin_http','phase_control','control','set_global_stop'),
('p-phase-control-backlog','admin_http','phase_control','control','set_emergency_stop'),
('p-phase-control-backlog','admin_http','phase_control','control','clear_emergency_stop'),
('p-phase-control-backlog','admin_http','phase_control','control','clear_global_stop'),
('p-phase-control-backlog','admin_http','phase_control','control','fence_update'),
('p-phase-control-live','admin_http','phase_control','control','pause'),
('p-phase-control-live','admin_http','phase_control','control','set_global_stop'),
('p-phase-control-live','admin_http','phase_control','control','set_emergency_stop'),
('p-phase-control-live','admin_http','phase_control','control','clear_emergency_stop'),
('p-phase-control-live','admin_http','phase_control','control','clear_global_stop'),
('p-phase-control-live','admin_http','phase_control','control','fence_update'),
('p-phase-control-paused','admin_http','phase_control','control','enter_backlog'),
('p-phase-control-paused','admin_http','phase_control','control','enter_live'),
('p-phase-control-paused','admin_http','phase_control','control','disable'),
('p-phase-control-paused','admin_http','phase_control','control','set_global_stop'),
('p-phase-control-paused','admin_http','phase_control','control','set_emergency_stop'),
('p-phase-control-paused','admin_http','phase_control','control','clear_emergency_stop'),
('p-phase-control-paused','admin_http','phase_control','control','clear_global_stop'),
('p-phase-control-paused','admin_http','phase_control','control','fence_update'),
('p-restore-control-disabled','restore_operator','restore','restore','recovery_begin'),
('p-restore-control-disabled','restore_operator','restore','restore','recovery_advance'),
('p-restore-control-disabled','restore_operator','restore','restore','recovery_abort'),
('p-restore-control-paused','restore_operator','restore','restore','recovery_begin'),
('p-restore-control-paused','restore_operator','restore','restore','recovery_advance'),
('p-restore-control-paused','restore_operator','restore','restore','recovery_abort'),
('p-supervisor-restore-disabled','system_supervisor','restore','restore','writer_epoch_bump'),
('p-supervisor-restore-disabled','system_supervisor','restore','restore','recovery_complete'),
('p-supervisor-restore-paused','system_supervisor','restore','restore','writer_epoch_bump'),
('p-supervisor-restore-paused','system_supervisor','restore','restore','recovery_complete'),
('p-supervisor-fence-disabled','system_supervisor','system_producer','control','fence_update'),
('p-supervisor-fence-paused','system_supervisor','system_producer','control','fence_update');
CREATE TRIGGER internal_control_action_policy_no_insert
BEFORE INSERT ON internal_control_action_policy WHEN EXISTS(SELECT 1 FROM internal_control_action_policy)
BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_control_action_policy_no_update BEFORE UPDATE ON internal_control_action_policy
BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_control_action_policy_no_delete BEFORE DELETE ON internal_control_action_policy
BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;

-- Policy-derived minimum fence multiset.  Operation input may neither omit a
-- row nor add an unrelated receipt.  Successor 0008/0009 consume these generic
-- kinds/scopes without adding business fields to migration 0007.
CREATE TABLE internal_required_fence_policy (
  policy_id TEXT NOT NULL REFERENCES internal_operation_policy(policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  scope_selector TEXT NOT NULL CHECK(scope_selector IN ('source_id','candidate_id','publication_id','global')),
  fence_kind TEXT NOT NULL CHECK(fence_kind IN ('deletion','publication','completeness','rights','media')),
  required_state TEXT NOT NULL CHECK(required_state IN ('clear','blocked_reconcile_readonly','clear_or_blocked_removal')),
  PRIMARY KEY(policy_id,scope_selector,fence_kind)
) WITHOUT ROWID, STRICT;

-- Refine consumes the candidate publication gate; bilingual additionally
-- requires candidate completeness.
INSERT INTO internal_required_fence_policy
SELECT policy_id,'candidate_id','publication','clear' FROM internal_operation_policy WHERE operation_kind='refine';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'candidate_id','completeness','clear' FROM internal_operation_policy WHERE operation_kind='refine' AND owner_process='bilingual_refiner';

-- Review cannot omit source deletion/rights/media or candidate
-- publication/completeness.  A gate evaluator may issue a clear/not-applicable
-- receipt, but an empty set is never equivalent.
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','deletion','clear' FROM internal_operation_policy WHERE operation_kind='review';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','rights','clear' FROM internal_operation_policy WHERE operation_kind='review';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','media','clear' FROM internal_operation_policy WHERE operation_kind='review';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'candidate_id','publication','clear' FROM internal_operation_policy WHERE operation_kind='review';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'candidate_id','completeness','clear' FROM internal_operation_policy WHERE operation_kind='review';

-- Publication and projection bind every generic successor gate to the exact
-- publication identity.
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','deletion','clear' FROM internal_operation_policy WHERE operation_kind IN ('publish','projection');
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','publication','clear' FROM internal_operation_policy WHERE operation_kind IN ('publish','projection');
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','completeness','clear' FROM internal_operation_policy WHERE operation_kind IN ('publish','projection');
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','rights','clear' FROM internal_operation_policy WHERE operation_kind IN ('publish','projection');
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','media','clear' FROM internal_operation_policy WHERE operation_kind IN ('publish','projection');

-- X backfill requires exact source-scoped deletion/rights/media receipts.
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','deletion','clear' FROM internal_operation_policy WHERE operation_kind='backfill';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','rights','clear' FROM internal_operation_policy WHERE operation_kind='backfill';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','media','clear' FROM internal_operation_policy WHERE operation_kind='backfill';

-- Read-only reconcile may inspect a blocked identity but Unknown still blocks.
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','deletion','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='x_official_https';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','rights','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='x_official_https';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','media','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='x_official_https';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','deletion','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='projection_private';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','publication','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='projection_private';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','completeness','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='projection_private';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','rights','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='projection_private';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','media','blocked_reconcile_readonly' FROM internal_operation_policy WHERE operation_kind='reconcile' AND egress_class='projection_private';

INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','deletion','clear' FROM internal_operation_policy WHERE operation_kind='source_delete';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'source_id','publication','clear' FROM internal_operation_policy WHERE operation_kind='source_delete';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','deletion','clear_or_blocked_removal' FROM internal_operation_policy WHERE operation_kind='withdraw';
INSERT INTO internal_required_fence_policy
SELECT policy_id,'publication_id','publication','clear_or_blocked_removal' FROM internal_operation_policy WHERE operation_kind='withdraw';

CREATE TRIGGER internal_required_fence_policy_no_insert BEFORE INSERT ON internal_required_fence_policy
BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_required_fence_policy_no_update BEFORE UPDATE ON internal_required_fence_policy
BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_required_fence_policy_no_delete BEFORE DELETE ON internal_required_fence_policy
BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;

CREATE TABLE owner_authorization_handoff (
  handoff_id TEXT PRIMARY KEY,
  owner_process TEXT NOT NULL,
  issuer TEXT NOT NULL CHECK(issuer='f1plus1-owner-supervisor-v1'),
  one_time_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(one_time_nonce AS BLOB))=43),
  release_sha256 TEXT NOT NULL CHECK(length(release_sha256)=64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  receipt_sha256 TEXT NOT NULL UNIQUE CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_by_operation_id TEXT UNIQUE
) STRICT;

-- Deliberately no seed. Schema 7 is fail closed until the DB-external owner
-- supervisor handoff and gateway-only authorizer are implemented and verified.
CREATE TRIGGER owner_authorization_handoff_update_guard
BEFORE UPDATE ON owner_authorization_handoff
WHEN OLD.consumed_by_operation_id IS NOT NULL
  OR NEW.handoff_id<>OLD.handoff_id OR NEW.owner_process<>OLD.owner_process OR NEW.issuer<>OLD.issuer
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.release_sha256<>OLD.release_sha256
  OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.receipt_sha256<>OLD.receipt_sha256
  OR NEW.verified_at<>OLD.verified_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.consumed_by_operation_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.consumed_by_operation_id AND op.authorization_handoff_id=NEW.handoff_id AND op.state='requested')
BEGIN SELECT RAISE(ABORT,'OWNER_HANDOFF_IMMUTABLE'); END;
CREATE TRIGGER owner_authorization_handoff_no_delete
BEFORE DELETE ON owner_authorization_handoff BEGIN SELECT RAISE(ABORT,'OWNER_HANDOFF_IMMUTABLE'); END;

CREATE TABLE internal_operation (
  operation_id TEXT PRIMARY KEY CHECK(length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN (
    'collect','refine','review','publish','reconcile','projection','backfill',
    'source_create','source_update','source_delete','system_producer','phase_control',
    'backup','restore','withdraw'
  )),
  owner_process TEXT NOT NULL CHECK(owner_process IN (
    'rss_collector','rss_refiner','automatic_reviewer','automatic_publisher',
    'projection_sender','projection_receiver','x_official_adapter','bilingual_refiner',
    'admin_http','admin_telemetry_producer','backup_worker','restore_operator','system_supervisor','reconciler'
  )),
  capability_class TEXT NOT NULL CHECK(capability_class IN ('db_mutation','external_attempt','reconcile_readonly','control','backup','restore')),
  policy_id TEXT NOT NULL REFERENCES internal_operation_policy(policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  authorization_handoff_id TEXT NOT NULL REFERENCES owner_authorization_handoff(handoff_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  control_action TEXT CHECK(control_action IS NULL OR control_action IN (
    'enter_backlog','enter_live','pause','disable','set_global_stop','clear_global_stop',
    'set_emergency_stop','clear_emergency_stop','recovery_begin','recovery_advance',
    'recovery_complete','recovery_abort','writer_epoch_bump','fence_update'
  )),
  state TEXT NOT NULL CHECK(state IN (
    'requested','authorized','attempt_committed','in_flight','succeeded','blocked',
    'reconcile_required','terminal_failed','cancelled'
  )),
  version INTEGER NOT NULL CHECK(version>=1),
  candidate_id TEXT,
  source_id TEXT,
  publication_id TEXT,
  public_id TEXT,
  phase TEXT NOT NULL CHECK(phase IN ('disabled','backlog','live','paused')),
  attempt INTEGER NOT NULL CHECK(attempt>=0),
  budget_reservation_id TEXT,
  egress_class TEXT NOT NULL CHECK(egress_class IN ('none','rss_https','model_https','projection_private','x_official_https','backup_private')),
  model_route_ref TEXT,
  expected_schema_sha256 TEXT NOT NULL CHECK(length(expected_schema_sha256)=64 AND expected_schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_release_sha256 TEXT NOT NULL CHECK(length(expected_release_sha256)=64 AND expected_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_manifest_sha256 TEXT NOT NULL CHECK(length(expected_manifest_sha256)=64 AND expected_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_config_epoch INTEGER NOT NULL CHECK(source_config_epoch>=1),
  source_safety_epoch INTEGER NOT NULL CHECK(source_safety_epoch>=1),
  authorization_version INTEGER NOT NULL CHECK(authorization_version>=1),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  source_stop_epoch INTEGER,
  global_stop_state TEXT NOT NULL CHECK(global_stop_state IN ('clear','stopped','unknown')),
  emergency_stop_state TEXT NOT NULL CHECK(emergency_stop_state IN ('clear','stopped','unknown')),
  recovery_state TEXT NOT NULL CHECK(recovery_state IN ('fenced','restoring','verifying','ready','failed','unknown')),
  deletion_fence_state TEXT NOT NULL CHECK(deletion_fence_state IN ('clear','blocked','unknown')),
  publication_fence_state TEXT NOT NULL CHECK(publication_fence_state IN ('clear','blocked','unknown')),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  expected_control_version INTEGER NOT NULL CHECK(expected_control_version>=1),
  expected_entity_version INTEGER CHECK(expected_entity_version IS NULL OR expected_entity_version>=0),
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  entity_set_json TEXT NOT NULL CHECK(json_valid(entity_set_json) AND json_type(entity_set_json)='array'),
  entity_set_hash TEXT NOT NULL CHECK(length(entity_set_hash)=64 AND entity_set_hash NOT GLOB '*[^0-9a-f]*'),
  required_fence_set_json TEXT NOT NULL CHECK(json_valid(required_fence_set_json) AND json_type(required_fence_set_json)='array'),
  required_fence_set_hash TEXT NOT NULL CHECK(length(required_fence_set_hash)=64 AND required_fence_set_hash NOT GLOB '*[^0-9a-f]*'),
  expected_writer_epoch INTEGER NOT NULL CHECK(expected_writer_epoch>=1),
  result_hash TEXT CHECK(result_hash IS NULL OR (length(result_hash)=64 AND result_hash NOT GLOB '*[^0-9a-f]*')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((egress_class='none')=(budget_reservation_id IS NULL)),
  CHECK((operation_kind='refine' AND egress_class='model_https')=(model_route_ref IS NOT NULL)),
  CHECK((operation_kind='phase_control' OR (operation_kind='restore' AND egress_class='none')
    OR (operation_kind='system_producer' AND owner_process='system_supervisor'))=(control_action IS NOT NULL)),
  CHECK(source_id IS NOT NULL OR source_stop_epoch IS NULL),
  CHECK(state NOT IN ('succeeded','blocked','terminal_failed','cancelled') OR result_hash IS NOT NULL)
) STRICT;

CREATE INDEX internal_operation_state_owner_idx
  ON internal_operation(state,owner_process,updated_at,operation_id);
CREATE INDEX internal_operation_entity_idx
  ON internal_operation(source_id,candidate_id,publication_id,operation_id);

-- Immutable request-time entity bindings are the only source for a write
-- permit.  Direct identities must match the operation column byte-for-byte;
-- child rows are named in the canonical entity set and verified by the
-- external authorizer before the operation can leave requested.
CREATE TABLE operation_entity_binding (
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
    'publication','published_projection','projection_outbox','projection_receipt','legacy_admin_operation',
    'legacy_audit','internal_control','telemetry_receipt','generic_fence','backup','projection_pointer'
  )),
  entity_id TEXT NOT NULL,
  identity_selector TEXT NOT NULL CHECK(identity_selector IN (
    'source_id','candidate_id','publication_id','public_id','control_singleton','bound_child'
  )),
  expected_entity_version INTEGER CHECK(expected_entity_version IS NULL OR expected_entity_version>=0),
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  entity_set_hash TEXT NOT NULL CHECK(length(entity_set_hash)=64 AND entity_set_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY(operation_id,entity_kind,entity_id)
) WITHOUT ROWID, STRICT;
CREATE TRIGGER operation_entity_binding_insert_guard BEFORE INSERT ON operation_entity_binding
WHEN NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id
    AND op.state='requested' AND op.entity_set_hash=NEW.entity_set_hash
    AND ((NEW.identity_selector='source_id' AND NEW.entity_id=op.source_id)
      OR (NEW.identity_selector='candidate_id' AND NEW.entity_id=op.candidate_id)
      OR (NEW.identity_selector='publication_id' AND NEW.entity_id=op.publication_id)
      OR (NEW.identity_selector='public_id' AND NEW.entity_id=op.public_id)
      OR (NEW.identity_selector='control_singleton' AND NEW.entity_id IN ('1','active'))
      OR NEW.identity_selector='bound_child'))
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_INVALID'); END;
CREATE TRIGGER operation_entity_binding_no_update BEFORE UPDATE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;
CREATE TRIGGER operation_entity_binding_no_delete BEFORE DELETE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;

CREATE TABLE route_registry (
  route_id TEXT PRIMARY KEY,
  route_class TEXT NOT NULL CHECK(route_class IN ('rss','model','projection','x_official','backup')),
  egress_class TEXT NOT NULL CHECK(egress_class IN ('rss_https','model_https','projection_private','x_official_https','backup_private')),
  endpoint_class TEXT NOT NULL CHECK(endpoint_class IN ('rss_fetch','model_refine','projection_deliver','x_read','x_write','x_reconcile','backup_copy','restore_read')),
  endpoint_identity_sha256 TEXT NOT NULL CHECK(length(endpoint_identity_sha256)=64 AND endpoint_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  release_sha256 TEXT NOT NULL CHECK(length(release_sha256)=64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('active','disabled','unknown')),
  version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE TRIGGER route_registry_no_update BEFORE UPDATE ON route_registry BEGIN SELECT RAISE(ABORT,'ROUTE_REGISTRY_IMMUTABLE'); END;
CREATE TRIGGER route_registry_no_delete BEFORE DELETE ON route_registry BEGIN SELECT RAISE(ABORT,'ROUTE_REGISTRY_IMMUTABLE'); END;

CREATE TABLE budget_account (
  account_id TEXT PRIMARY KEY,
  unit_kind TEXT NOT NULL,
  hard_limit INTEGER NOT NULL CHECK(hard_limit>=0),
  consumed_units INTEGER NOT NULL CHECK(consumed_units>=0 AND consumed_units<=hard_limit),
  reserved_units INTEGER NOT NULL CHECK(reserved_units>=0 AND consumed_units+reserved_units<=hard_limit),
  version INTEGER NOT NULL CHECK(version>=1)
) STRICT;
CREATE TABLE budget_reservation (
  reservation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES budget_account(account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  units INTEGER NOT NULL CHECK(units>0),
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released','reconcile_required')),
  version INTEGER NOT NULL CHECK(version>=1),
  attempt_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK((state='consumed')=(consumed_at IS NOT NULL))
) STRICT;
CREATE TRIGGER budget_reservation_insert_guard BEFORE INSERT ON budget_reservation
WHEN NEW.state<>'reserved' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op JOIN budget_account account ON account.account_id=NEW.account_id
    WHERE op.operation_id=NEW.operation_id AND op.budget_reservation_id=NEW.reservation_id
      AND op.state='requested' AND account.consumed_units+account.reserved_units+NEW.units<=account.hard_limit)
BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_INVALID'); END;
CREATE TRIGGER budget_reservation_account_reserve AFTER INSERT ON budget_reservation
BEGIN UPDATE budget_account SET reserved_units=reserved_units+NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;
CREATE TRIGGER budget_reservation_transition_guard BEFORE UPDATE ON budget_reservation
WHEN NEW.version<>OLD.version+1 OR NEW.reservation_id<>OLD.reservation_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.account_id<>OLD.account_id OR NEW.units<>OLD.units OR NEW.created_at<>OLD.created_at
  OR NOT ((OLD.state='reserved' AND NEW.state IN ('consumed','released','reconcile_required'))
    OR (OLD.state='reconcile_required' AND NEW.state IN ('consumed','released')))
BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_TRANSITION_INVALID'); END;
CREATE TRIGGER budget_reservation_account_consume AFTER UPDATE OF state ON budget_reservation WHEN NEW.state='consumed'
BEGIN UPDATE budget_account SET reserved_units=reserved_units-NEW.units,consumed_units=consumed_units+NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;
CREATE TRIGGER budget_reservation_account_release AFTER UPDATE OF state ON budget_reservation WHEN NEW.state='released'
BEGIN UPDATE budget_account SET reserved_units=reserved_units-NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;
CREATE TRIGGER budget_account_update_guard BEFORE UPDATE ON budget_account
WHEN NEW.version<>OLD.version+1 OR NEW.account_id<>OLD.account_id OR NEW.unit_kind<>OLD.unit_kind OR NEW.hard_limit<>OLD.hard_limit
  OR NEW.consumed_units<OLD.consumed_units OR NEW.reserved_units<0 OR NEW.consumed_units+NEW.reserved_units>NEW.hard_limit
BEGIN SELECT RAISE(ABORT,'BUDGET_ACCOUNT_TRANSITION_INVALID'); END;
CREATE TRIGGER budget_account_no_delete BEFORE DELETE ON budget_account BEGIN SELECT RAISE(ABORT,'BUDGET_ACCOUNT_IMMUTABLE'); END;
CREATE TRIGGER budget_reservation_no_delete BEFORE DELETE ON budget_reservation BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_IMMUTABLE'); END;

CREATE TABLE generic_fence_receipt (
  fence_receipt_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','source','candidate','publication')),
  scope_id TEXT,
  fence_kind TEXT NOT NULL CHECK(fence_kind IN ('deletion','publication','completeness','rights','media')),
  state TEXT NOT NULL CHECK(state IN ('clear','blocked','unknown')),
  reason_code TEXT NOT NULL,
  issuer TEXT NOT NULL CHECK(issuer IN ('f1plus1-gate-evaluator-v1','f1plus1-system-supervisor-v1')),
  issued_by_operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  one_time_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(one_time_nonce AS BLOB))=43),
  receipt_sha256 TEXT NOT NULL UNIQUE CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>=1),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK((scope_kind='global')=(scope_id IS NULL)),
  CHECK(datetime(observed_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
  CHECK(datetime(expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at
    AND unixepoch(expires_at)>unixepoch(observed_at))
) STRICT;
CREATE TRIGGER generic_fence_receipt_no_update BEFORE UPDATE ON generic_fence_receipt BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER generic_fence_receipt_no_delete BEFORE DELETE ON generic_fence_receipt BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_IMMUTABLE'); END;

CREATE TABLE operation_fence_binding (
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  fence_receipt_id TEXT NOT NULL REFERENCES generic_fence_receipt(fence_receipt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','source','candidate','publication')),
  scope_id TEXT,
  fence_kind TEXT NOT NULL CHECK(fence_kind IN ('deletion','publication','completeness','rights','media')),
  required_state TEXT NOT NULL CHECK(required_state IN ('clear','blocked_reconcile_readonly','clear_or_blocked_removal')),
  receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  fence_set_hash TEXT NOT NULL CHECK(length(fence_set_hash)=64 AND fence_set_hash NOT GLOB '*[^0-9a-f]*'),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>=1),
  one_time_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(one_time_nonce AS BLOB))=43),
  prechecked_at TEXT,
  consumed_at TEXT,
  postchecked_at TEXT,
  version INTEGER NOT NULL CHECK(version>=1),
  PRIMARY KEY(operation_id,fence_receipt_id),
  CHECK((scope_kind='global')=(scope_id IS NULL)),
  CHECK((prechecked_at IS NULL AND consumed_at IS NULL AND postchecked_at IS NULL)
     OR (prechecked_at IS NOT NULL AND consumed_at=prechecked_at)),
  CHECK(postchecked_at IS NULL OR unixepoch(postchecked_at)>=unixepoch(prechecked_at))
) WITHOUT ROWID, STRICT;
CREATE TRIGGER operation_fence_binding_insert_guard BEFORE INSERT ON operation_fence_binding
WHEN NEW.version<>1 OR NEW.prechecked_at IS NOT NULL OR NEW.consumed_at IS NOT NULL OR NEW.postchecked_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op JOIN generic_fence_receipt r ON r.fence_receipt_id=NEW.fence_receipt_id
    WHERE op.operation_id=NEW.operation_id AND op.state='requested'
      AND op.required_fence_set_hash=NEW.fence_set_hash
      AND r.scope_kind=NEW.scope_kind AND r.scope_id IS NEW.scope_id AND r.fence_kind=NEW.fence_kind
      AND r.receipt_sha256=NEW.receipt_sha256 AND r.policy_epoch=NEW.policy_epoch
      AND r.recovery_epoch=NEW.recovery_epoch AND r.writer_epoch=NEW.writer_epoch
      AND NEW.policy_epoch=op.policy_epoch AND NEW.recovery_epoch=op.recovery_epoch
      AND NEW.writer_epoch=op.expected_writer_epoch
      AND ((NEW.scope_kind='global' AND NEW.scope_id IS NULL)
        OR (NEW.scope_kind='source' AND NEW.scope_id=op.source_id)
        OR (NEW.scope_kind='candidate' AND NEW.scope_id=op.candidate_id)
        OR (NEW.scope_kind='publication' AND NEW.scope_id=op.publication_id)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_BINDING_INVALID'); END;
CREATE TRIGGER operation_fence_binding_update_guard BEFORE UPDATE ON operation_fence_binding
WHEN NEW.operation_id<>OLD.operation_id OR NEW.fence_receipt_id<>OLD.fence_receipt_id
  OR NEW.scope_kind<>OLD.scope_kind OR NEW.scope_id IS NOT OLD.scope_id OR NEW.fence_kind<>OLD.fence_kind
  OR NEW.required_state<>OLD.required_state OR NEW.receipt_sha256<>OLD.receipt_sha256
  OR NEW.fence_set_hash<>OLD.fence_set_hash OR NEW.policy_epoch<>OLD.policy_epoch
  OR NEW.recovery_epoch<>OLD.recovery_epoch OR NEW.writer_epoch<>OLD.writer_epoch
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.version<>OLD.version+1
  OR NOT ((OLD.prechecked_at IS NULL AND NEW.prechecked_at IS NOT NULL AND NEW.consumed_at=NEW.prechecked_at AND NEW.postchecked_at IS NULL)
    OR (OLD.prechecked_at IS NOT NULL AND OLD.postchecked_at IS NULL AND NEW.prechecked_at=OLD.prechecked_at
      AND NEW.consumed_at=OLD.consumed_at AND NEW.postchecked_at IS NOT NULL))
  OR datetime(COALESCE(NEW.postchecked_at,NEW.prechecked_at)) IS NULL
  OR strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.postchecked_at,NEW.prechecked_at))<>COALESCE(NEW.postchecked_at,NEW.prechecked_at)
  OR NOT EXISTS(SELECT 1 FROM generic_fence_receipt r WHERE r.fence_receipt_id=NEW.fence_receipt_id
    AND r.receipt_sha256=NEW.receipt_sha256 AND r.scope_kind=NEW.scope_kind AND r.scope_id IS NEW.scope_id
    AND r.fence_kind=NEW.fence_kind AND r.policy_epoch=NEW.policy_epoch AND r.recovery_epoch=NEW.recovery_epoch
    AND r.writer_epoch=NEW.writer_epoch AND r.state<>'unknown'
    AND ((NEW.required_state='clear' AND r.state='clear')
      OR (NEW.required_state='blocked_reconcile_readonly' AND r.state IN ('clear','blocked'))
      OR (NEW.required_state='clear_or_blocked_removal' AND r.state IN ('clear','blocked')))
    AND unixepoch(r.expires_at)>unixepoch(COALESCE(NEW.postchecked_at,NEW.prechecked_at)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_REREAD_INVALID'); END;
CREATE TRIGGER operation_fence_binding_no_delete BEFORE DELETE ON operation_fence_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_BINDING_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_insert_guard
BEFORE INSERT ON internal_operation
WHEN NEW.state<>'requested'
  OR NOT EXISTS(
    SELECT 1 FROM internal_operation_policy p
    JOIN owner_authorization_handoff h ON h.handoff_id=NEW.authorization_handoff_id
    WHERE p.policy_id=NEW.policy_id
      AND p.owner_process=NEW.owner_process AND p.operation_kind=NEW.operation_kind
      AND p.capability_class=NEW.capability_class AND p.phase=NEW.phase
      AND p.egress_class=NEW.egress_class
      AND ((NEW.control_action IS NULL AND NOT EXISTS(
          SELECT 1 FROM internal_control_action_policy ap WHERE ap.policy_id=p.policy_id))
        OR EXISTS(SELECT 1 FROM internal_control_action_policy ap
          WHERE ap.policy_id=p.policy_id AND ap.owner_process=NEW.owner_process
            AND ap.operation_kind=NEW.operation_kind AND ap.capability_class=NEW.capability_class
            AND ap.control_action=NEW.control_action))
      AND h.owner_process=NEW.owner_process
      AND h.release_sha256=NEW.expected_release_sha256
      AND h.manifest_sha256=NEW.expected_manifest_sha256
      AND h.consumed_by_operation_id IS NULL
      AND unixepoch(h.verified_at) IS NOT NULL AND unixepoch(h.expires_at)>unixepoch(NEW.created_at)
      AND ((p.required_identity='none')
        OR (p.required_identity='source' AND NEW.source_id IS NOT NULL)
        OR (p.required_identity='candidate' AND NEW.candidate_id IS NOT NULL)
        OR (p.required_identity='publication' AND NEW.publication_id IS NOT NULL)
        OR (p.required_identity='source_candidate' AND NEW.source_id IS NOT NULL AND NEW.candidate_id IS NOT NULL)
        OR (p.required_identity='publication_public' AND NEW.publication_id IS NOT NULL AND NEW.public_id IS NOT NULL))
  )
BEGIN SELECT RAISE(ABORT,'OWNER_OPERATION_POLICY_INVALID'); END;

CREATE TABLE internal_external_attempt (
  attempt_id TEXT PRIMARY KEY CHECK(length(CAST(attempt_id AS BLOB)) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK(attempt_number>=1),
  attempt_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(attempt_nonce AS BLOB))=43),
  state TEXT NOT NULL CHECK(state IN ('intent_committed','started','response_committed','reconcile_required','terminal_failed')),
  route_id TEXT NOT NULL,
  endpoint_class TEXT NOT NULL,
  external_idempotency_key TEXT NOT NULL UNIQUE,
  reconcile_key TEXT NOT NULL UNIQUE,
  provider_resource_identity TEXT NOT NULL,
  canonical_request_json TEXT NOT NULL CHECK(json_valid(canonical_request_json) AND json_type(canonical_request_json)='object'),
  canonical_request_hash TEXT NOT NULL CHECK(length(canonical_request_hash)=64 AND canonical_request_hash NOT GLOB '*[^0-9a-f]*'),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  reconcile_identity_sha256 TEXT NOT NULL CHECK(length(reconcile_identity_sha256)=64 AND reconcile_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  response_identity_sha256 TEXT CHECK(response_identity_sha256 IS NULL OR (length(response_identity_sha256)=64 AND response_identity_sha256 NOT GLOB '*[^0-9a-f]*')),
  response_hash TEXT CHECK(response_hash IS NULL OR (length(response_hash)=64 AND response_hash NOT GLOB '*[^0-9a-f]*')),
  external_calls INTEGER NOT NULL CHECK(external_calls IN (0,1)),
  outcome TEXT NOT NULL CHECK(outcome IN ('pending','succeeded','known_failed','unknown')),
  started_at TEXT,
  committed_at TEXT NOT NULL,
  reason_code TEXT,
  reconcile_consumed_at TEXT,
  UNIQUE(operation_id,attempt_number),
  CHECK(state='intent_committed' OR external_calls=1),
  CHECK(outcome<>'unknown' OR state='reconcile_required'),
  CHECK(reconcile_consumed_at IS NULL OR state IN ('response_committed','terminal_failed')),
  CHECK(response_identity_sha256 IS NULL OR state IN ('response_committed','terminal_failed')),
  CHECK(state<>'response_committed' OR (response_hash IS NOT NULL AND response_identity_sha256 IS NOT NULL))
) STRICT;

CREATE TRIGGER internal_external_attempt_insert_guard
BEFORE INSERT ON internal_external_attempt
WHEN NEW.state<>'intent_committed' OR NEW.external_calls<>0 OR NEW.outcome<>'pending'
  OR NOT EXISTS(SELECT 1 FROM internal_operation op
    JOIN route_registry route ON route.route_id=NEW.route_id
    JOIN budget_reservation reservation ON reservation.reservation_id=op.budget_reservation_id
    WHERE op.operation_id=NEW.operation_id AND op.state='attempt_committed'
      AND op.capability_class IN ('external_attempt','backup','restore','reconcile_readonly')
      AND NEW.attempt_number=op.attempt AND NEW.canonical_request_hash=op.request_hash
      AND NEW.request_fingerprint=op.request_fingerprint
      AND route.egress_class=op.egress_class AND route.state='active'
      AND json_extract(NEW.canonical_request_json,'$.schemaVersion')='external-request-v1'
      AND json_extract(NEW.canonical_request_json,'$.routeId')=NEW.route_id
      AND json_extract(NEW.canonical_request_json,'$.endpointClass')=NEW.endpoint_class
      AND json_extract(NEW.canonical_request_json,'$.providerResource')=NEW.provider_resource_identity
      AND json_extract(NEW.canonical_request_json,'$.externalIdempotencyKey')=NEW.external_idempotency_key
      AND json_extract(NEW.canonical_request_json,'$.reconcileKey')=NEW.reconcile_key
      AND json_extract(NEW.canonical_request_json,'$.expected.routeIdentitySha256')=route.endpoint_identity_sha256
      AND route.endpoint_class=NEW.endpoint_class
      AND reservation.operation_id=op.operation_id AND reservation.state='reserved'
      AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
        JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
        WHERE f.operation_id=op.operation_id AND (f.prechecked_at IS NULL OR f.consumed_at IS NULL
          OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
          OR receipt.policy_epoch<>op.policy_epoch OR receipt.recovery_epoch<>op.recovery_epoch
          OR receipt.writer_epoch<>op.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.committed_at))))
BEGIN SELECT RAISE(ABORT,'EXTERNAL_ATTEMPT_INTENT_INVALID'); END;

CREATE INDEX internal_external_attempt_operation_idx
  ON internal_external_attempt(operation_id,attempt_number);

CREATE TABLE internal_operation_outbox (
  outbox_id TEXT PRIMARY KEY CHECK(length(CAST(outbox_id AS BLOB)) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  outbox_kind TEXT NOT NULL CHECK(outbox_kind IN ('projection_delivery','withdraw_delivery','telemetry_receipt','backup_copy','reconcile_query')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','succeeded','reconcile_required','terminal_failed','cancelled')),
  version INTEGER NOT NULL CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(operation_id,outbox_kind)
) STRICT;

CREATE INDEX internal_operation_outbox_state_idx
  ON internal_operation_outbox(state,updated_at,outbox_id);

CREATE TABLE internal_operation_audit (
  audit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'operation_requested','operation_authorized','operation_blocked','attempt_intent_committed',
    'attempt_started','attempt_response_committed','operation_reconcile_required',
    'operation_succeeded','operation_terminal_failed','operation_cancelled',
    'phase_changed','stop_changed','recovery_changed','write_permit_consumed'
  )),
  actor_ref TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(json_valid(event_json) AND json_type(event_json)='object'),
  previous_event_hash TEXT CHECK(previous_event_hash IS NULL OR (length(previous_event_hash)=64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash)=64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX internal_operation_audit_operation_idx
  ON internal_operation_audit(operation_id,audit_seq);

CREATE TABLE gateway_write_permit (
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
    'publication','published_projection','projection_outbox','projection_receipt','legacy_admin_operation',
    'legacy_audit','internal_control','telemetry_receipt','generic_fence','backup','projection_pointer'
  )),
  entity_id TEXT NOT NULL,
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN ('insert','update','delete','activate','consume')),
  expected_entity_version INTEGER,
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_id,entity_kind,entity_id,mutation_kind),
  CHECK(expected_entity_version IS NULL OR expected_entity_version>=0)
) STRICT;

CREATE TABLE gateway_entity_policy (
  operation_kind TEXT NOT NULL,
  capability_class TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN ('insert','update','delete','activate','consume')),
  identity_selector TEXT NOT NULL CHECK(identity_selector IN ('source_id','candidate_id','publication_id','public_id','control_singleton','bound_child')),
  PRIMARY KEY(operation_kind,capability_class,entity_kind,mutation_kind)
) WITHOUT ROWID, STRICT;
INSERT INTO gateway_entity_policy VALUES
('collect','external_attempt','ingest_run','insert','bound_child'),('collect','external_attempt','ingest_run','update','bound_child'),
('collect','external_attempt','candidate','insert','candidate_id'),('collect','external_attempt','candidate','update','candidate_id'),
('collect','external_attempt','rss_media','insert','bound_child'),('collect','external_attempt','source','update','source_id'),
('refine','external_attempt','machine_draft','insert','bound_child'),
('review','db_mutation','candidate','update','candidate_id'),('review','db_mutation','review_bundle','insert','bound_child'),
('review','db_mutation','review_decision','insert','bound_child'),('review','db_mutation','publication','insert','publication_id'),
('review','db_mutation','legacy_admin_operation','insert','bound_child'),('review','db_mutation','legacy_audit','insert','bound_child'),
('publish','db_mutation','publication','update','publication_id'),('publish','db_mutation','published_projection','insert','public_id'),
('publish','db_mutation','projection_outbox','insert','bound_child'),('publish','db_mutation','candidate','update','candidate_id'),
('publish','db_mutation','legacy_admin_operation','insert','bound_child'),('publish','db_mutation','legacy_audit','insert','bound_child'),
('projection','external_attempt','projection_outbox','update','bound_child'),('projection','external_attempt','projection_receipt','insert','bound_child'),
('projection','external_attempt','legacy_audit','insert','bound_child'),('projection','db_mutation','projection_pointer','activate','control_singleton'),
('source_create','control','source','insert','source_id'),('source_update','control','source','update','source_id'),('source_delete','control','source','delete','source_id'),
('phase_control','control','internal_control','update','control_singleton'),('system_producer','db_mutation','telemetry_receipt','insert','bound_child'),
('system_producer','control','generic_fence','insert','bound_child'),
('backup','backup','backup','insert','bound_child'),('restore','restore','internal_control','update','control_singleton'),
('restore','restore','projection_pointer','activate','control_singleton'),('withdraw','db_mutation','publication','update','publication_id'),
('withdraw','db_mutation','projection_outbox','insert','bound_child');

CREATE UNIQUE INDEX gateway_write_permit_pending_entity_idx
  ON gateway_write_permit(entity_kind,entity_id,mutation_kind) WHERE consumed_at IS NULL;

CREATE TRIGGER gateway_write_permit_insert_guard BEFORE INSERT ON gateway_write_permit
WHEN NOT EXISTS(SELECT 1 FROM internal_operation op JOIN gateway_entity_policy ep
  ON ep.operation_kind=op.operation_kind AND ep.capability_class=op.capability_class
  JOIN operation_entity_binding binding ON binding.operation_id=op.operation_id
    AND binding.entity_kind=NEW.entity_kind AND binding.entity_id=NEW.entity_id
  WHERE op.operation_id=NEW.operation_id AND op.state='authorized'
    AND ep.entity_kind=NEW.entity_kind AND ep.mutation_kind=NEW.mutation_kind
    AND ep.identity_selector=binding.identity_selector
    AND binding.expected_entity_version IS NEW.expected_entity_version
    AND binding.expected_entity_hash=NEW.expected_entity_hash
    AND binding.entity_set_hash=op.entity_set_hash
    AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
      WHERE f.operation_id=op.operation_id AND (f.prechecked_at IS NULL OR f.consumed_at IS NULL
        OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
        OR receipt.policy_epoch<>op.policy_epoch OR receipt.recovery_epoch<>op.recovery_epoch
        OR receipt.writer_epoch<>op.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.created_at))))
BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_POLICY_INVALID'); END;
CREATE TRIGGER gateway_write_permit_update_guard BEFORE UPDATE ON gateway_write_permit
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.entity_kind<>OLD.entity_kind OR NEW.entity_id<>OLD.entity_id OR NEW.mutation_kind<>OLD.mutation_kind
  OR NEW.expected_entity_version IS NOT OLD.expected_entity_version OR NEW.expected_entity_hash<>OLD.expected_entity_hash
  OR NEW.created_at<>OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;
CREATE TRIGGER gateway_write_permit_no_delete BEFORE DELETE ON gateway_write_permit BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER generic_fence_receipt_insert_guard BEFORE INSERT ON generic_fence_receipt
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  WHERE p.entity_kind='generic_fence' AND p.entity_id=NEW.fence_receipt_id AND p.mutation_kind='insert'
    AND p.consumed_at IS NULL AND op.operation_id=NEW.issued_by_operation_id AND op.state='authorized'
    AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
    AND op.capability_class='control' AND op.control_action='fence_update'
    AND op.policy_epoch=NEW.policy_epoch AND op.recovery_epoch=NEW.recovery_epoch
    AND op.expected_writer_epoch=NEW.writer_epoch)
BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_ISSUER_INVALID'); END;

CREATE TABLE backup_recovery_point (
  recovery_point_id TEXT PRIMARY KEY,
  backup_set_id TEXT NOT NULL UNIQUE,
  backup_manifest_sha256 TEXT NOT NULL UNIQUE CHECK(length(backup_manifest_sha256)=64 AND backup_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  database_snapshot_sha256 TEXT NOT NULL CHECK(length(database_snapshot_sha256)=64 AND database_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  database_schema_sha256 TEXT NOT NULL CHECK(length(database_schema_sha256)=64 AND database_schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  sqlite_snapshot_method TEXT NOT NULL CHECK(sqlite_snapshot_method IN ('online_backup_api','vacuum_into_verified')),
  source_db_wal_shm_identity_sha256 TEXT NOT NULL CHECK(length(source_db_wal_shm_identity_sha256)=64 AND source_db_wal_shm_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_manifest_sha256 TEXT NOT NULL CHECK(length(file_manifest_sha256)=64 AND file_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  total_bytes INTEGER NOT NULL CHECK(total_bytes>0),
  release_sha256 TEXT NOT NULL CHECK(length(release_sha256)=64 AND release_sha256 NOT GLOB '*[^0-9a-f]*'),
  deployment_manifest_sha256 TEXT NOT NULL CHECK(length(deployment_manifest_sha256)=64 AND deployment_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  projection_generation INTEGER NOT NULL CHECK(projection_generation>=0),
  projection_manifest_sha256 TEXT CHECK(projection_manifest_sha256 IS NULL OR (length(projection_manifest_sha256)=64 AND projection_manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
  projection_pointer_sha256 TEXT CHECK(projection_pointer_sha256 IS NULL OR (length(projection_pointer_sha256)=64 AND projection_pointer_sha256 NOT GLOB '*[^0-9a-f]*')),
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  writer_authority_receipt_sha256 TEXT NOT NULL CHECK(length(writer_authority_receipt_sha256)=64 AND writer_authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  common_checkpoint_sha256 TEXT NOT NULL UNIQUE CHECK(length(common_checkpoint_sha256)=64 AND common_checkpoint_sha256 NOT GLOB '*[^0-9a-f]*'),
  recovery_point_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  rpo_seconds INTEGER NOT NULL CHECK(rpo_seconds BETWEEN 0 AND 900),
  off_host_verified INTEGER NOT NULL CHECK(off_host_verified=1),
  remote_receipt_sha256 TEXT NOT NULL CHECK(length(remote_receipt_sha256)=64 AND remote_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  encrypted INTEGER NOT NULL CHECK(encrypted=1),
  encryption_key_version TEXT NOT NULL,
  retention_policy_id TEXT NOT NULL,
  restore_drill_state TEXT NOT NULL CHECK(restore_drill_state IN ('verified','failed')),
  restore_duration_seconds INTEGER CHECK(restore_duration_seconds IS NULL OR restore_duration_seconds BETWEEN 0 AND 14400),
  drill_isolated INTEGER NOT NULL CHECK(drill_isolated IN (0,1)),
  drill_decryption_verified INTEGER NOT NULL CHECK(drill_decryption_verified IN (0,1)),
  drill_hash_verified INTEGER NOT NULL CHECK(drill_hash_verified IN (0,1)),
  drill_integrity_verified INTEGER NOT NULL CHECK(drill_integrity_verified IN (0,1)),
  drill_fk_verified INTEGER NOT NULL CHECK(drill_fk_verified IN (0,1)),
  drill_schema_verified INTEGER NOT NULL CHECK(drill_schema_verified IN (0,1)),
  drill_bootable INTEGER NOT NULL CHECK(drill_bootable IN (0,1)),
  drill_business_point_verified INTEGER NOT NULL CHECK(drill_business_point_verified IN (0,1)),
  drill_public_pointer_verified INTEGER NOT NULL CHECK(drill_public_pointer_verified IN (0,1)),
  incident_declared_at TEXT NOT NULL,
  admin_available_at TEXT NOT NULL,
  public_available_at TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK(datetime(recovery_point_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',recovery_point_at)=recovery_point_at
    AND date(substr(recovery_point_at,1,10),'+0 days')=substr(recovery_point_at,1,10)),
  CHECK(datetime(completed_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',completed_at)=completed_at
    AND date(substr(completed_at,1,10),'+0 days')=substr(completed_at,1,10)
    AND unixepoch(completed_at)>=unixepoch(recovery_point_at)),
  CHECK(datetime(incident_declared_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',incident_declared_at)=incident_declared_at
    AND date(substr(incident_declared_at,1,10),'+0 days')=substr(incident_declared_at,1,10)),
  CHECK(datetime(admin_available_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',admin_available_at)=admin_available_at
    AND date(substr(admin_available_at,1,10),'+0 days')=substr(admin_available_at,1,10)),
  CHECK(datetime(public_available_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',public_available_at)=public_available_at
    AND date(substr(public_available_at,1,10),'+0 days')=substr(public_available_at,1,10)),
  CHECK((projection_generation=0 AND projection_manifest_sha256 IS NULL AND projection_pointer_sha256 IS NULL)
     OR (projection_generation>0 AND projection_manifest_sha256 IS NOT NULL AND projection_pointer_sha256 IS NOT NULL)),
  CHECK((restore_drill_state='verified' AND restore_duration_seconds IS NOT NULL
      AND drill_isolated=1 AND drill_decryption_verified=1 AND drill_hash_verified=1
      AND drill_integrity_verified=1 AND drill_fk_verified=1 AND drill_schema_verified=1
      AND drill_bootable=1 AND drill_business_point_verified=1 AND drill_public_pointer_verified=1
      AND max(unixepoch(admin_available_at),unixepoch(public_available_at))-unixepoch(incident_declared_at)<=14400)
    OR (restore_drill_state='failed'))
) STRICT;

CREATE INDEX backup_recovery_point_time_idx
  ON backup_recovery_point(recovery_point_at DESC,recovery_point_id);

CREATE TABLE projection_recovery_anchor (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
  active_generation INTEGER NOT NULL CHECK(active_generation>=0),
  active_manifest_sha256 TEXT,
  active_pointer_sha256 TEXT,
  writer_epoch INTEGER NOT NULL CHECK(writer_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  writer_authority_receipt_sha256 TEXT NOT NULL CHECK(length(writer_authority_receipt_sha256)=64 AND writer_authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  common_checkpoint_sha256 TEXT NOT NULL CHECK(length(common_checkpoint_sha256)=64 AND common_checkpoint_sha256 NOT GLOB '*[^0-9a-f]*'),
  version INTEGER NOT NULL CHECK(version>=1),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  CHECK((active_generation=0 AND active_manifest_sha256 IS NULL AND active_pointer_sha256 IS NULL)
     OR (active_generation>0 AND active_manifest_sha256 IS NOT NULL AND active_pointer_sha256 IS NOT NULL)),
  CHECK(active_manifest_sha256 IS NULL OR (length(active_manifest_sha256)=64 AND active_manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK(active_pointer_sha256 IS NULL OR (length(active_pointer_sha256)=64 AND active_pointer_sha256 NOT GLOB '*[^0-9a-f]*'))
) STRICT;

CREATE VIEW valid_backup_recovery_point_v1 AS
SELECT * FROM backup_recovery_point
WHERE off_host_verified=1 AND encrypted=1 AND rpo_seconds<=900
  AND restore_drill_state='verified' AND restore_duration_seconds<=14400
  AND datetime(recovery_point_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',recovery_point_at)=recovery_point_at
  AND date(substr(recovery_point_at,1,10),'+0 days')=substr(recovery_point_at,1,10)
  AND datetime(completed_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',completed_at)=completed_at
  AND date(substr(completed_at,1,10),'+0 days')=substr(completed_at,1,10)
  AND unixepoch(completed_at)>=unixepoch(recovery_point_at)
  AND datetime(incident_declared_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',incident_declared_at)=incident_declared_at
  AND date(substr(incident_declared_at,1,10),'+0 days')=substr(incident_declared_at,1,10)
  AND datetime(admin_available_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',admin_available_at)=admin_available_at
  AND date(substr(admin_available_at,1,10),'+0 days')=substr(admin_available_at,1,10)
  AND datetime(public_available_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',public_available_at)=public_available_at
  AND date(substr(public_available_at,1,10),'+0 days')=substr(public_available_at,1,10)
  AND max(unixepoch(admin_available_at),unixepoch(public_available_at))-unixepoch(incident_declared_at)<=14400
  AND drill_isolated=1 AND drill_decryption_verified=1 AND drill_hash_verified=1
  AND drill_integrity_verified=1 AND drill_fk_verified=1 AND drill_schema_verified=1
  AND drill_bootable=1 AND drill_business_point_verified=1 AND drill_public_pointer_verified=1;

CREATE TRIGGER backup_recovery_point_insert_guard BEFORE INSERT ON backup_recovery_point
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  WHERE p.entity_kind='backup' AND p.entity_id=NEW.recovery_point_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
    AND op.operation_kind='backup' AND op.state='authorized' AND op.recovery_epoch=NEW.recovery_epoch)
BEGIN SELECT RAISE(ABORT,'BACKUP_OPERATION_REQUIRED'); END;
CREATE TRIGGER backup_recovery_point_no_update BEFORE UPDATE ON backup_recovery_point BEGIN SELECT RAISE(ABORT,'RECOVERY_POINT_IMMUTABLE'); END;
CREATE TRIGGER backup_recovery_point_no_delete BEFORE DELETE ON backup_recovery_point BEGIN SELECT RAISE(ABORT,'RECOVERY_POINT_IMMUTABLE'); END;

CREATE TRIGGER projection_recovery_anchor_insert_guard BEFORE INSERT ON projection_recovery_anchor
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  JOIN internal_control c ON c.singleton_id=1
  WHERE p.entity_kind='projection_pointer' AND p.entity_id='active' AND p.mutation_kind='activate' AND p.consumed_at IS NULL
    AND op.operation_id=NEW.operation_id AND op.state='authorized'
    AND NEW.writer_epoch=c.writer_epoch AND NEW.recovery_epoch=c.recovery_epoch
    AND NEW.writer_authority_receipt_sha256=c.writer_authority_receipt_sha256)
BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_AUTHORITY_INVALID'); END;
CREATE TRIGGER projection_recovery_anchor_update_guard BEFORE UPDATE ON projection_recovery_anchor
WHEN NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  JOIN internal_control c ON c.singleton_id=1
  WHERE p.entity_kind='projection_pointer' AND p.entity_id='active' AND p.mutation_kind='activate' AND p.consumed_at IS NULL
    AND op.operation_id=NEW.operation_id AND op.state='authorized'
    AND NEW.writer_epoch=c.writer_epoch AND NEW.recovery_epoch=c.recovery_epoch
    AND NEW.writer_authority_receipt_sha256=c.writer_authority_receipt_sha256)
BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_AUTHORITY_INVALID'); END;
CREATE TRIGGER projection_recovery_anchor_no_delete BEFORE DELETE ON projection_recovery_anchor BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_IMMUTABLE'); END;

CREATE VIEW internal_operation_current_v1 AS
SELECT operation_id,idempotency_key,operation_kind,owner_process,state,version,
       source_id,candidate_id,publication_id,public_id,phase,attempt,egress_class,
       source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
       source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,
       deletion_fence_state,publication_fence_state,expected_entity_hash,entity_set_hash,
       required_fence_set_hash,expected_writer_epoch,reason_code,created_at,updated_at
FROM internal_operation;

CREATE TRIGGER internal_control_transition_guard
BEFORE UPDATE ON internal_control
WHEN NEW.version<>OLD.version+1
  OR NEW.updated_by_operation_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM internal_operation op
    JOIN internal_operation_policy policy ON policy.policy_id=op.policy_id
    JOIN internal_control_action_policy action_policy ON action_policy.policy_id=op.policy_id
      AND action_policy.owner_process=op.owner_process
      AND action_policy.operation_kind=op.operation_kind
      AND action_policy.capability_class=op.capability_class
      AND action_policy.control_action=op.control_action
    JOIN gateway_write_permit permit ON permit.operation_id=op.operation_id
      AND permit.entity_kind='internal_control' AND permit.entity_id='1'
      AND permit.mutation_kind='update' AND permit.consumed_at IS NULL
    WHERE op.operation_id=NEW.updated_by_operation_id
      AND op.operation_kind IN ('phase_control','restore')
      AND op.owner_process IN ('admin_http','restore_operator','system_supervisor')
      AND op.state='authorized'
      AND op.recovery_epoch=OLD.recovery_epoch
  )
  OR NOT EXISTS(
    SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.updated_by_operation_id AND (
      (op.control_action IN ('enter_backlog','enter_live','pause','disable')
        AND NEW.global_stop_state=OLD.global_stop_state AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256
        AND ((op.control_action='enter_backlog' AND OLD.phase IN ('disabled','paused') AND NEW.phase='backlog')
          OR (op.control_action='enter_live' AND OLD.phase IN ('backlog','paused') AND NEW.phase='live')
          OR (op.control_action='pause' AND OLD.phase IN ('disabled','backlog','live') AND NEW.phase='paused')
          OR (op.control_action='disable' AND OLD.phase='paused' AND NEW.phase='disabled')))
      OR (op.control_action='set_global_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND OLD.global_stop_state='clear' AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='set_emergency_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state='stopped' AND OLD.emergency_stop_state='clear'
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='clear_emergency_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND OLD.emergency_stop_state='stopped' AND NEW.emergency_stop_state='clear'
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='clear_global_stop' AND NEW.phase=OLD.phase AND OLD.global_stop_state='stopped'
        AND NEW.global_stop_state='clear' AND NEW.emergency_stop_state='clear' AND NEW.recovery_state='ready'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_begin' AND NEW.phase IN ('disabled','paused') AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state IN ('ready','failed') AND NEW.recovery_state='fenced'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_advance' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND ((OLD.recovery_state='fenced' AND NEW.recovery_state='restoring')
          OR (OLD.recovery_state='restoring' AND NEW.recovery_state='verifying'))
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_abort' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND OLD.recovery_state IN ('fenced','restoring','verifying') AND NEW.recovery_state='failed'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='writer_epoch_bump' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state='verifying' AND NEW.recovery_state='verifying'
        AND NEW.recovery_epoch=OLD.recovery_epoch+1 AND NEW.writer_epoch=OLD.writer_epoch+1
        AND NEW.writer_authority_receipt_sha256<>OLD.writer_authority_receipt_sha256
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch>=OLD.source_config_epoch AND NEW.source_safety_epoch>=OLD.source_safety_epoch
        AND NEW.authorization_version>=OLD.authorization_version AND NEW.policy_epoch>=OLD.policy_epoch)
      OR (op.control_action='recovery_complete' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state='verifying' AND NEW.recovery_state='ready'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='fence_update' AND NEW.phase=OLD.phase AND NEW.global_stop_state=OLD.global_stop_state
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND NEW.recovery_state=OLD.recovery_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
    )
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_CONTROL_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_operation_transition_guard
BEFORE UPDATE ON internal_operation
WHEN NEW.version<>OLD.version+1
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.operation_kind<>OLD.operation_kind
  OR NEW.owner_process<>OLD.owner_process
  OR NEW.capability_class<>OLD.capability_class
  OR NEW.policy_id<>OLD.policy_id
  OR NEW.authorization_handoff_id<>OLD.authorization_handoff_id
  OR NEW.control_action IS NOT OLD.control_action
  OR NEW.candidate_id IS NOT OLD.candidate_id
  OR NEW.source_id IS NOT OLD.source_id
  OR NEW.publication_id IS NOT OLD.publication_id
  OR NEW.public_id IS NOT OLD.public_id
  OR NEW.phase<>OLD.phase
  OR NEW.budget_reservation_id IS NOT OLD.budget_reservation_id
  OR NEW.egress_class<>OLD.egress_class
  OR NEW.model_route_ref IS NOT OLD.model_route_ref
  OR NEW.expected_schema_sha256<>OLD.expected_schema_sha256
  OR NEW.expected_release_sha256<>OLD.expected_release_sha256
  OR NEW.expected_manifest_sha256<>OLD.expected_manifest_sha256
  OR NEW.source_config_epoch<>OLD.source_config_epoch
  OR NEW.source_safety_epoch<>OLD.source_safety_epoch
  OR NEW.authorization_version<>OLD.authorization_version
  OR NEW.policy_epoch<>OLD.policy_epoch
  OR NEW.recovery_epoch<>OLD.recovery_epoch
  OR NEW.source_stop_epoch IS NOT OLD.source_stop_epoch
  OR NEW.global_stop_state<>OLD.global_stop_state
  OR NEW.emergency_stop_state<>OLD.emergency_stop_state
  OR NEW.recovery_state<>OLD.recovery_state
  OR NEW.deletion_fence_state<>OLD.deletion_fence_state
  OR NEW.publication_fence_state<>OLD.publication_fence_state
  OR NEW.request_hash<>OLD.request_hash
  OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.expected_control_version<>OLD.expected_control_version
  OR NEW.expected_entity_version IS NOT OLD.expected_entity_version
  OR NEW.expected_entity_hash<>OLD.expected_entity_hash
  OR NEW.entity_set_json<>OLD.entity_set_json OR NEW.entity_set_hash<>OLD.entity_set_hash
  OR NEW.required_fence_set_json<>OLD.required_fence_set_json OR NEW.required_fence_set_hash<>OLD.required_fence_set_hash
  OR NEW.expected_writer_epoch<>OLD.expected_writer_epoch
  OR NEW.created_at<>OLD.created_at
  OR NOT (
    (OLD.state='requested' AND NEW.state IN ('authorized','blocked','cancelled')) OR
    (OLD.state='authorized' AND NEW.state IN ('attempt_committed','succeeded','blocked','cancelled')) OR
    (OLD.state='attempt_committed' AND NEW.state IN ('in_flight','reconcile_required','terminal_failed')) OR
    (OLD.state='in_flight' AND NEW.state IN ('succeeded','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('succeeded','terminal_failed','cancelled'))
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_operation_authorize_guard
BEFORE UPDATE OF state ON internal_operation
WHEN NEW.state='authorized' AND (
  OLD.state<>'requested'
  OR NOT EXISTS(SELECT 1 FROM owner_authorization_handoff h WHERE h.handoff_id=NEW.authorization_handoff_id AND h.consumed_by_operation_id=NEW.operation_id)
  OR NOT EXISTS(SELECT 1 FROM internal_control c WHERE c.singleton_id=1
    AND c.version=NEW.expected_control_version
    AND c.phase=NEW.phase
    AND c.source_config_epoch=NEW.source_config_epoch
    AND c.source_safety_epoch=NEW.source_safety_epoch
    AND c.authorization_version=NEW.authorization_version
    AND c.policy_epoch=NEW.policy_epoch
    AND c.recovery_epoch=NEW.recovery_epoch
    AND c.writer_epoch=NEW.expected_writer_epoch
    AND c.global_stop_state=NEW.global_stop_state
    AND c.emergency_stop_state=NEW.emergency_stop_state
    AND c.recovery_state=NEW.recovery_state
    AND c.deletion_fence_state=NEW.deletion_fence_state
    AND c.publication_fence_state=NEW.publication_fence_state)
  OR NOT EXISTS(SELECT 1 FROM internal_operation_policy p WHERE p.policy_id=NEW.policy_id
    AND (p.allow_global_stop=1 OR NEW.global_stop_state='clear')
    AND (p.allow_emergency_stop=1 OR NEW.emergency_stop_state='clear')
    AND (p.allowed_recovery_state='any'
      OR (p.allowed_recovery_state='ready' AND NEW.recovery_state='ready')
      OR (p.allowed_recovery_state='not_ready' AND NEW.recovery_state<>'ready'))
    AND (p.deletion_fence_mode IN ('not_applicable','reconcile_only') OR NEW.deletion_fence_state='clear')
    AND (p.publication_fence_mode IN ('not_applicable','reconcile_only') OR NEW.publication_fence_state='clear'))
  OR (NEW.control_action IS NOT NULL AND NOT EXISTS(SELECT 1 FROM internal_control_action_policy ap
    WHERE ap.policy_id=NEW.policy_id AND ap.owner_process=NEW.owner_process
      AND ap.operation_kind=NEW.operation_kind AND ap.capability_class=NEW.capability_class
      AND ap.control_action=NEW.control_action))
  OR json_array_length(NEW.entity_set_json)<>(SELECT count(*) FROM operation_entity_binding b WHERE b.operation_id=NEW.operation_id)
  OR json_array_length(NEW.entity_set_json)<>(SELECT count(DISTINCT json_extract(value,'$.entityKind')||char(0)||json_extract(value,'$.entityId')) FROM json_each(NEW.entity_set_json))
  OR EXISTS(SELECT 1 FROM json_each(NEW.entity_set_json) item
    WHERE json_type(item.value)<>'object' OR NOT EXISTS(SELECT 1 FROM operation_entity_binding b
      WHERE b.operation_id=NEW.operation_id
        AND b.entity_kind=json_extract(item.value,'$.entityKind')
        AND b.entity_id=json_extract(item.value,'$.entityId')
        AND b.expected_entity_version IS json_extract(item.value,'$.expectedVersion')
        AND b.expected_entity_hash=json_extract(item.value,'$.expectedHash')
        AND b.entity_set_hash=NEW.entity_set_hash))
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='source_id' AND b.entity_id=NEW.source_id))
  OR (NEW.candidate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='candidate_id' AND b.entity_id=NEW.candidate_id))
  OR (NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='publication_id' AND b.entity_id=NEW.publication_id))
  OR (NEW.public_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='public_id' AND b.entity_id=NEW.public_id))
  OR (SELECT count(*) FROM internal_required_fence_policy template WHERE template.policy_id=NEW.policy_id)
    <>(SELECT count(*) FROM operation_fence_binding f WHERE f.operation_id=NEW.operation_id)
  OR EXISTS(SELECT 1 FROM internal_required_fence_policy template
    WHERE template.policy_id=NEW.policy_id AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      WHERE f.operation_id=NEW.operation_id AND f.fence_kind=template.fence_kind
        AND f.required_state=template.required_state
        AND ((template.scope_selector='global' AND f.scope_kind='global' AND f.scope_id IS NULL)
          OR (template.scope_selector='source_id' AND f.scope_kind='source' AND f.scope_id=NEW.source_id)
          OR (template.scope_selector='candidate_id' AND f.scope_kind='candidate' AND f.scope_id=NEW.candidate_id)
          OR (template.scope_selector='publication_id' AND f.scope_kind='publication' AND f.scope_id=NEW.publication_id))))
  OR json_array_length(NEW.required_fence_set_json)<>(SELECT count(*) FROM operation_fence_binding f WHERE f.operation_id=NEW.operation_id)
  OR json_array_length(NEW.required_fence_set_json)<>(SELECT count(DISTINCT json_extract(value,'$.fenceReceiptId')) FROM json_each(NEW.required_fence_set_json))
  OR EXISTS(SELECT 1 FROM json_each(NEW.required_fence_set_json) item
    WHERE json_type(item.value)<>'object' OR NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
      WHERE f.operation_id=NEW.operation_id
        AND f.fence_receipt_id=json_extract(item.value,'$.fenceReceiptId')
        AND f.receipt_sha256=json_extract(item.value,'$.receiptSha256')
        AND f.scope_kind=json_extract(item.value,'$.scopeKind')
        AND f.scope_id IS json_extract(item.value,'$.scopeId')
        AND f.fence_kind=json_extract(item.value,'$.fenceKind')
        AND f.prechecked_at IS NOT NULL AND f.consumed_at=f.prechecked_at
        AND f.fence_set_hash=NEW.required_fence_set_hash
        AND receipt.receipt_sha256=f.receipt_sha256 AND receipt.state<>'unknown'
        AND ((f.required_state='clear' AND receipt.state='clear')
          OR (f.required_state='blocked_reconcile_readonly' AND NEW.capability_class='reconcile_readonly' AND receipt.state IN ('clear','blocked'))
          OR (f.required_state='clear_or_blocked_removal' AND NEW.operation_kind='withdraw' AND receipt.state IN ('clear','blocked')))
        AND receipt.policy_epoch=NEW.policy_epoch AND receipt.recovery_epoch=NEW.recovery_epoch
        AND receipt.writer_epoch=NEW.expected_writer_epoch
        AND unixepoch(receipt.expires_at)>unixepoch(NEW.updated_at)))
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source s WHERE s.source_id=NEW.source_id AND s.stop_epoch=NEW.source_stop_epoch
      AND (EXISTS(SELECT 1 FROM internal_operation_policy p WHERE p.policy_id=NEW.policy_id AND p.source_fence_mode IN ('not_applicable','quarantine_only')) OR s.enabled=1)))
)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_AUTHORIZATION_INVALID'); END;

CREATE TRIGGER internal_operation_fence_terminal_guard
BEFORE UPDATE OF state ON internal_operation
WHEN NEW.state='succeeded' AND EXISTS(SELECT 1 FROM operation_fence_binding f
  JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
  WHERE f.operation_id=NEW.operation_id AND (f.postchecked_at IS NULL
    OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
    OR receipt.policy_epoch<>NEW.policy_epoch OR receipt.recovery_epoch<>NEW.recovery_epoch
    OR receipt.writer_epoch<>NEW.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.updated_at)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_POSTCHECK_REQUIRED'); END;

CREATE TRIGGER internal_operation_no_delete
BEFORE DELETE ON internal_operation BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_IMMUTABLE'); END;
CREATE TRIGGER internal_external_attempt_transition_guard
BEFORE UPDATE ON internal_external_attempt
WHEN NEW.attempt_id<>OLD.attempt_id
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.attempt_number<>OLD.attempt_number
  OR NEW.attempt_nonce<>OLD.attempt_nonce
  OR NEW.route_id<>OLD.route_id OR NEW.endpoint_class<>OLD.endpoint_class
  OR NEW.external_idempotency_key<>OLD.external_idempotency_key
  OR NEW.reconcile_key<>OLD.reconcile_key
  OR NEW.provider_resource_identity IS NOT OLD.provider_resource_identity
  OR NEW.canonical_request_json<>OLD.canonical_request_json
  OR NEW.canonical_request_hash<>OLD.canonical_request_hash
  OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.reconcile_identity_sha256<>OLD.reconcile_identity_sha256
  OR (NEW.response_identity_sha256 IS NOT OLD.response_identity_sha256
    AND NOT (OLD.response_identity_sha256 IS NULL AND NEW.response_identity_sha256 IS NOT NULL
      AND NEW.state IN ('response_committed','terminal_failed')))
  OR (NEW.response_hash IS NOT OLD.response_hash
    AND NOT (OLD.response_hash IS NULL AND NEW.response_hash IS NOT NULL
      AND NEW.state IN ('response_committed','terminal_failed')))
  OR NEW.committed_at<>OLD.committed_at
  OR NOT (
    (OLD.state='intent_committed' AND NEW.state IN ('started','response_committed','reconcile_required','terminal_failed')) OR
    (OLD.state='started' AND NEW.state IN ('response_committed','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('response_committed','terminal_failed'))
  )
  OR (NEW.state='started' AND (NEW.external_calls<>1 OR NEW.outcome<>'pending'))
  OR (NEW.state='response_committed' AND (NEW.external_calls<>1 OR NEW.outcome NOT IN ('succeeded','known_failed')))
  OR (NEW.state='reconcile_required' AND NEW.outcome<>'unknown')
  OR (NEW.state='terminal_failed' AND NEW.outcome<>'known_failed')
  OR (OLD.state='reconcile_required' AND NEW.reconcile_consumed_at IS NULL)
  OR (OLD.reconcile_consumed_at IS NOT NULL AND NEW.reconcile_consumed_at<>OLD.reconcile_consumed_at)
BEGIN SELECT RAISE(ABORT,'INTERNAL_ATTEMPT_TRANSITION_INVALID'); END;
CREATE TRIGGER internal_external_attempt_no_delete
BEFORE DELETE ON internal_external_attempt BEGIN SELECT RAISE(ABORT,'INTERNAL_ATTEMPT_IMMUTABLE'); END;
CREATE TRIGGER internal_operation_audit_no_update
BEFORE UPDATE ON internal_operation_audit BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER internal_operation_audit_no_delete
BEFORE DELETE ON internal_operation_audit BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER internal_operation_audit_predecessor_guard
BEFORE INSERT ON internal_operation_audit
WHEN (NOT EXISTS(SELECT 1 FROM internal_operation_audit) AND NEW.previous_event_hash IS NOT NULL)
  OR (EXISTS(SELECT 1 FROM internal_operation_audit) AND NEW.previous_event_hash IS NOT
      (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1))
BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_PREDECESSOR_INVALID'); END;

CREATE TRIGGER internal_external_attempt_unknown_guard
BEFORE UPDATE ON internal_external_attempt
WHEN NEW.outcome='unknown' AND NOT EXISTS(
  SELECT 1 FROM internal_operation op
  WHERE op.operation_id=NEW.operation_id AND op.state='reconcile_required'
)
BEGIN SELECT RAISE(ABORT,'UNKNOWN_OUTCOME_RECONCILE_REQUIRED'); END;
CREATE TRIGGER internal_external_attempt_budget_guard
BEFORE UPDATE ON internal_external_attempt
WHEN (NEW.state='reconcile_required' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='reconcile_required'))
  OR (NEW.state='response_committed' AND NEW.outcome='succeeded' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='consumed'))
  OR (NEW.state IN ('response_committed','terminal_failed') AND NEW.outcome='known_failed' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='released'))
BEGIN SELECT RAISE(ABORT,'ATTEMPT_BUDGET_STATE_INVALID'); END;

CREATE TRIGGER internal_operation_outbox_transition_guard
BEFORE UPDATE ON internal_operation_outbox
WHEN NEW.version<>OLD.version+1
  OR NEW.outbox_id<>OLD.outbox_id
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.outbox_kind<>OLD.outbox_kind
  OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.payload_json<>OLD.payload_json
  OR NEW.payload_hash<>OLD.payload_hash
  OR NEW.created_at<>OLD.created_at
  OR NOT (
    (OLD.state='pending' AND NEW.state IN ('leased','cancelled')) OR
    (OLD.state='leased' AND NEW.state IN ('succeeded','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('succeeded','terminal_failed','cancelled'))
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_OUTBOX_TRANSITION_INVALID'); END;
CREATE TRIGGER internal_operation_outbox_no_delete
BEFORE DELETE ON internal_operation_outbox BEGIN SELECT RAISE(ABORT,'INTERNAL_OUTBOX_IMMUTABLE'); END;

-- Legacy tables remain byte-compatible for existing rows. From schema 7 onward,
-- all new gateway-controlled writes require an unconsumed, entity-scoped permit.
CREATE VIEW authorized_gateway_write_permit_v1 AS
SELECT p.* FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
WHERE op.state='authorized';
CREATE TRIGGER gateway_ingest_run_insert_guard BEFORE INSERT ON ingest_run
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='ingest_run' AND p.entity_id=NEW.run_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_candidate_insert_guard BEFORE INSERT ON pending_review_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='candidate' AND p.entity_id=NEW.candidate_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_review_bundle_insert_guard BEFORE INSERT ON review_bundle
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='review_bundle' AND p.entity_id=NEW.bundle_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_review_decision_insert_guard BEFORE INSERT ON review_decision
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='review_decision' AND p.entity_id=NEW.decision_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_publication_insert_guard BEFORE INSERT ON publication
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='publication' AND p.entity_id=NEW.publication_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_projection_insert_guard BEFORE INSERT ON published_projection
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='published_projection' AND p.entity_id=NEW.projection_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_projection_outbox_insert_guard BEFORE INSERT ON projection_outbox
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_outbox' AND p.entity_id=NEW.delivery_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_projection_receipt_insert_guard BEFORE INSERT ON projection_delivery_receipt
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_receipt' AND p.entity_id=NEW.delivery_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

-- Exhaustive schema-6 mutation guard set. The static inventory binds all 43
-- current statements to these table/action guards and the entity policy above.
CREATE TRIGGER gateway_source_insert_guard BEFORE INSERT ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=NEW.source_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_update_guard BEFORE UPDATE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_delete_guard BEFORE DELETE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='delete' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_ingest_run_update_guard BEFORE UPDATE ON ingest_run
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='ingest_run' AND p.entity_id=OLD.run_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_ingest_run_delete_guard BEFORE DELETE ON ingest_run BEGIN SELECT RAISE(ABORT,'LEGACY_DELETE_FORBIDDEN'); END;
CREATE TRIGGER gateway_candidate_update_guard BEFORE UPDATE ON pending_review_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='candidate' AND p.entity_id=OLD.candidate_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_candidate_delete_guard BEFORE DELETE ON pending_review_candidate BEGIN SELECT RAISE(ABORT,'LEGACY_DELETE_FORBIDDEN'); END;
CREATE TRIGGER gateway_rss_media_insert_guard BEFORE INSERT ON rss_media_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='rss_media' AND p.entity_id=NEW.candidate_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_machine_draft_insert_guard BEFORE INSERT ON machine_summary_draft
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='machine_draft' AND p.entity_id=NEW.draft_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_publication_update_guard BEFORE UPDATE ON publication
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='publication' AND p.entity_id=OLD.publication_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_projection_outbox_update_guard BEFORE UPDATE ON projection_outbox
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_outbox' AND p.entity_id=OLD.delivery_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_admin_operation_insert_guard BEFORE INSERT ON admin_operation
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='legacy_admin_operation' AND p.entity_id=NEW.operation_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_audit_event_insert_guard BEFORE INSERT ON audit_event
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='legacy_audit' AND p.entity_id=NEW.event_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER internal_operation_policy_no_insert BEFORE INSERT ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_operation_policy_no_update BEFORE UPDATE ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_operation_policy_no_delete BEFORE DELETE ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER gateway_entity_policy_no_insert BEFORE INSERT ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER gateway_entity_policy_no_update BEFORE UPDATE ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER gateway_entity_policy_no_delete BEFORE DELETE ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

PRAGMA user_version=7;
DROP TABLE migration_0007_assert;
COMMIT;
