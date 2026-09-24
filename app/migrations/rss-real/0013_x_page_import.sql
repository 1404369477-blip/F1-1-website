-- X page import successor. Generated against the pinned 0012 schema; all original
-- table triggers/indexes below are retained except explicitly documented branches.
-- Apply only through applyXPageCloneMigration on a disposable clone. No production opener.
-- Parent holds the transaction and checks the complete resulting schema before COMMIT.


DROP TRIGGER gateway_source_delete_guard;

DROP TRIGGER gateway_source_insert_guard;

DROP TRIGGER gateway_source_update_guard;

ALTER TABLE source RENAME TO source_pre_0013;

CREATE TABLE "source" (
  source_id TEXT PRIMARY KEY,
  feed_url TEXT UNIQUE,
  source_kind TEXT NOT NULL DEFAULT 'rss' CHECK(source_kind IN('rss','x_page')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  stop_epoch INTEGER NOT NULL DEFAULT 1 CHECK (stop_epoch >= 1),
  etag TEXT CHECK (etag IS NULL OR (length(CAST(etag AS BLOB)) <= 1024 AND instr(etag, char(10)) = 0 AND instr(etag, char(13)) = 0)),
  last_modified TEXT CHECK (last_modified IS NULL OR (length(CAST(last_modified AS BLOB)) <= 1024 AND instr(last_modified, char(10)) = 0 AND instr(last_modified, char(13)) = 0)),
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_eligible_at TEXT,
  last_reason_code TEXT NOT NULL DEFAULT 'NEVER_RUN',
  CHECK ((source_kind='rss' AND feed_url IS NOT NULL AND (
    (source_id = 'motorsport-f1-news' AND feed_url = 'https://www.motorsport.com/rss/f1/news/') OR
    (source_id = 'autosport-f1-news' AND feed_url = 'https://www.autosport.com/rss/f1/news/') OR
    (source_id = 'racefans-f1-news' AND feed_url = 'https://www.racefans.net/category/formula-1/feed/') OR
    (source_id = 'the-race-f1-news' AND feed_url = 'https://www.the-race.com/category/formula-1/rss/') OR
    (source_id = 'skysports-f1-news' AND feed_url = 'https://www.skysports.com/rss/12433')
  )) OR (source_kind='x_page' AND source_id IN('x_f1','x_fia','x_mclarenf1','x_scuderiaferrari','x_mercedesamgf1','x_redbullracing','x_williamsf1','x_alpinef1team','x_astonmartinf1','x_haasf1team','x_audif1_','x_visacashapprb','x_lewishamilton','x_charles_leclerc','x_landonorris','x_max33verstappen','x_georgerussell63','x_pierregasly','x_alex_albon','x_alo_oficial','x_chrismedlandf1','x_tgruener','x_zhouguanyu24','x_nicorosberg','x_richardhammond','x_mrjamesmay','x_jeremyclarkson') AND feed_url IS NULL))
) STRICT;

INSERT INTO source(source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code) SELECT source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code FROM source_pre_0013;

INSERT INTO source(source_id,feed_url,source_kind,enabled,stop_epoch,last_reason_code)
    SELECT source_id,NULL,'x_page',0,source_safety_epoch,'X_PAGE_CLONE_CONFIGURED' FROM source_registry_v1 WHERE source_id IN(SELECT source_id FROM migration_0013_source);

DROP TABLE source_pre_0013;

CREATE TRIGGER gateway_source_delete_guard BEFORE DELETE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='delete' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_source_insert_guard BEFORE INSERT ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=NEW.source_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_source_update_guard BEFORE UPDATE ON source
WHEN (OLD.source_kind='x_page' OR NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)) AND NOT (OLD.source_kind='x_page' AND NEW.source_id=OLD.source_id AND NEW.source_kind=OLD.source_kind
 AND NEW.feed_url IS OLD.feed_url AND NEW.stop_epoch=OLD.stop_epoch+1
 AND NEW.etag IS OLD.etag AND NEW.last_modified IS OLD.last_modified AND NEW.last_attempt_at IS OLD.last_attempt_at
 AND NEW.last_success_at IS OLD.last_success_at AND NEW.next_eligible_at IS OLD.next_eligible_at AND NEW.last_reason_code=OLD.last_reason_code
 AND EXISTS(SELECT 1 FROM source_registry_v1 r JOIN source_registry_mutation_permit_v1 p ON p.operation_id=r.current_operation_id
 JOIN internal_operation op ON op.operation_id=p.operation_id
 WHERE r.source_id=OLD.source_id AND r.enabled=NEW.enabled AND p.source_id=r.source_id AND p.expected_revision=r.revision-1
 AND p.consumed_at IS NULL AND p.action IN('enable','disable','requeue','retire') AND op.state='authorized'
 AND op.owner_process='admin_http' AND op.source_id=r.source_id))
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

DROP TRIGGER source_registry_insert_effects;

DROP TRIGGER source_registry_insert_guard;

DROP INDEX source_registry_list_idx;

DROP TRIGGER source_registry_no_delete;

DROP TRIGGER source_registry_update_effects;

DROP TRIGGER source_registry_update_guard;

ALTER TABLE source_registry_v1 RENAME TO source_registry_v1_pre_0013;

CREATE TABLE source_registry_v1(
  source_id TEXT PRIMARY KEY CHECK(length(source_id) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK(revision>=1),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
  canonical_feed_url TEXT UNIQUE CHECK(canonical_feed_url IS NULL OR canonical_feed_url GLOB 'https://*'),
  canonical_url_valid INTEGER NOT NULL CHECK(canonical_url_valid IN(0,1)),
  site_url TEXT NOT NULL UNIQUE CHECK(site_url GLOB 'https://*'),
  source_kind TEXT NOT NULL CHECK(source_kind IN('rss','x_manual','x_page')),
  collection_mode TEXT NOT NULL CHECK(collection_mode IN('rss','manual_url','browser_visible_dom')),
  enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN('proposed','active','paused','retired')),
  collection_onboarding_status TEXT NOT NULL CHECK(collection_onboarding_status IN(
    'validating','activation_pending','queued','collecting','active','normalization_failed','dedup_needs_review','linked_existing',
    'blocked_adapter_missing','blocked_authorization','blocked_platform','queue_failed','collection_failed','stopped','cancelled','dead_letter')),
  normalization_status TEXT NOT NULL CHECK(normalization_status IN('pending','valid','invalid')),
  dedup_status TEXT NOT NULL CHECK(dedup_status IN('pending','unique','needs_review','linked_existing')),
  identity_status TEXT NOT NULL CHECK(identity_status IN('unknown','verified','needs_review')),
  relevance_status TEXT NOT NULL CHECK(relevance_status IN('unknown','qualified','rejected')),
  monitorability TEXT NOT NULL CHECK(monitorability IN('unknown','monitorable','restricted','unavailable')),
  adapter_status TEXT NOT NULL CHECK(adapter_status IN('unchecked','ready','missing','unavailable')),
  adapter_authorization_status TEXT NOT NULL CHECK(adapter_authorization_status IN('unknown','valid','invalid','expired')),
  authorization_expires_at TEXT CHECK(authorization_expires_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',authorization_expires_at)=authorization_expires_at),
  platform_allowed TEXT NOT NULL CHECK(platform_allowed IN('unknown','allowed','blocked')),
  source_stop_status TEXT NOT NULL CHECK(source_stop_status IN('clear','manual','compliance','authorization','platform')),
  source_config_epoch INTEGER NOT NULL CHECK(source_config_epoch>=1),
  source_safety_epoch INTEGER NOT NULL CHECK(source_safety_epoch>=1),
  authorization_version INTEGER NOT NULL CHECK(authorization_version>=1),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  identity_sha256 TEXT NOT NULL UNIQUE CHECK(length(identity_sha256)=64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  current_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  current_request_hash TEXT NOT NULL CHECK(length(current_request_hash)=64 AND current_request_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at),
  CHECK((source_kind='rss' AND collection_mode='rss' AND canonical_feed_url IS NOT NULL)
    OR (source_kind='x_manual' AND collection_mode='manual_url' AND canonical_feed_url IS NULL)
    OR (source_kind='x_page' AND collection_mode='browser_visible_dom' AND canonical_feed_url IS NULL AND source_id IN('x_f1','x_fia','x_mclarenf1','x_scuderiaferrari','x_mercedesamgf1','x_redbullracing','x_williamsf1','x_alpinef1team','x_astonmartinf1','x_haasf1team','x_audif1_','x_visacashapprb','x_lewishamilton','x_charles_leclerc','x_landonorris','x_max33verstappen','x_georgerussell63','x_pierregasly','x_alex_albon','x_alo_oficial','x_chrismedlandf1','x_tgruener','x_zhouguanyu24','x_nicorosberg','x_richardhammond','x_mrjamesmay','x_jeremyclarkson'))),
  CHECK(source_kind<>'x_manual' OR (enabled=0 AND lifecycle_status='proposed' AND collection_onboarding_status='validating'))
) STRICT;

INSERT INTO source_registry_v1 SELECT * FROM source_registry_v1_pre_0013;

UPDATE source_registry_v1 SET source_kind='x_page',collection_mode='browser_visible_dom',revision=revision+1,
    canonical_url_valid=1,normalization_status='valid',dedup_status='unique',identity_status='verified',
    adapter_status='ready',adapter_authorization_status='valid',platform_allowed='allowed',
    collection_onboarding_status='activation_pending',enabled=0,
    identity_sha256=(SELECT identity_sha256 FROM migration_0013_source WHERE source_id=source_registry_v1.source_id),
    authorization_expires_at=(SELECT authorization_expires_at FROM migration_0013_manifest),
    updated_at=(SELECT applied_at FROM migration_0013_manifest)
    WHERE source_id IN(SELECT source_id FROM migration_0013_source);

DROP TABLE source_registry_v1_pre_0013;

CREATE TRIGGER source_registry_insert_effects AFTER INSERT ON source_registry_v1
WHEN NEW.current_operation_id IS NOT NULL
BEGIN
  UPDATE source_registry_mutation_permit_v1 SET consumed_at=NEW.updated_at
  WHERE operation_id=NEW.current_operation_id AND source_id=NEW.source_id AND expected_revision=0 AND consumed_at IS NULL;
  INSERT INTO source_registry_history_v1 VALUES(
    'history-'||NEW.source_id||'-v1',NEW.source_id,NEW.current_operation_id,'proposed',NULL,1,NULL,
    NEW.lifecycle_status||'/'||NEW.collection_onboarding_status,
    (SELECT reason_code FROM source_registry_mutation_permit_v1 WHERE operation_id=NEW.current_operation_id),NEW.current_request_hash,NEW.updated_at
  );
  UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=NEW.current_request_hash,
    reason_code=(SELECT reason_code FROM source_registry_mutation_permit_v1 WHERE operation_id=NEW.current_operation_id),updated_at=NEW.updated_at
  WHERE operation_id=NEW.current_operation_id AND state='authorized';
  INSERT INTO internal_operation_audit(event_id,operation_id,event_type,actor_ref,event_json,previous_event_hash,event_hash,created_at)
  SELECT 'source-registry-'||NEW.current_operation_id,NEW.current_operation_id,'operation_succeeded','admin_http',
    json_object('sourceId',NEW.source_id,'revision',NEW.revision,'action','propose'),
    (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1),NEW.current_request_hash,NEW.updated_at;
END;

CREATE TRIGGER source_registry_insert_guard BEFORE INSERT ON source_registry_v1
WHEN NOT EXISTS(
  SELECT 1 FROM source_registry_mutation_permit_v1 p
  JOIN internal_operation op ON op.operation_id=p.operation_id
  JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
  WHERE p.operation_id=NEW.current_operation_id AND p.source_id=NEW.source_id AND p.action='propose'
    AND p.expected_revision=0 AND p.consumed_at IS NULL AND p.request_hash=NEW.current_request_hash AND NEW.revision=1 AND NEW.enabled=0
    AND op.state='authorized' AND op.updated_at=p.created_at AND op.request_hash=p.request_hash
    AND h.consumed_by_operation_id=op.operation_id AND h.expires_at>NEW.updated_at
    AND NEW.lifecycle_status='proposed' AND NEW.collection_onboarding_status='validating'
    AND NEW.normalization_status='pending' AND NEW.dedup_status='pending'
    AND NEW.identity_status='unknown' AND NEW.relevance_status='unknown' AND NEW.monitorability='unknown'
    AND NEW.adapter_status='unchecked' AND NEW.adapter_authorization_status='unknown'
    AND NEW.platform_allowed='unknown' AND NEW.source_stop_status='clear'
    AND NEW.source_config_epoch=op.source_config_epoch AND NEW.source_safety_epoch=op.source_safety_epoch
    AND NEW.authorization_version=op.authorization_version AND NEW.policy_epoch=op.policy_epoch AND NEW.recovery_epoch=op.recovery_epoch
    AND NEW.created_at=p.created_at AND NEW.updated_at=p.created_at
)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_PROPOSE_INVALID'); END;

CREATE INDEX source_registry_list_idx ON source_registry_v1(lifecycle_status,enabled,updated_at DESC,source_id);

CREATE TRIGGER source_registry_no_delete BEFORE DELETE ON source_registry_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RETIRE_IS_STATE_TRANSITION'); END;

CREATE TRIGGER source_registry_update_effects AFTER UPDATE ON source_registry_v1
BEGIN
  UPDATE source SET enabled=NEW.enabled,stop_epoch=stop_epoch+1
  WHERE source_id=NEW.source_id AND source_kind='x_page';
  UPDATE source_registry_mutation_permit_v1 SET consumed_at=NEW.updated_at
  WHERE operation_id=NEW.current_operation_id AND source_id=NEW.source_id AND expected_revision=OLD.revision AND consumed_at IS NULL;
  INSERT INTO source_registry_history_v1 VALUES(
    'history-'||NEW.source_id||'-v'||NEW.revision,NEW.source_id,NEW.current_operation_id,
    (SELECT CASE action WHEN 'validate' THEN 'validated' WHEN 'requeue' THEN 'requeued' WHEN 'enable' THEN 'enabled' WHEN 'disable' THEN 'disabled' WHEN 'retire' THEN 'retired' END
      FROM source_registry_mutation_permit_v1 WHERE source_id=NEW.source_id AND expected_revision=OLD.revision),
    OLD.revision,NEW.revision,OLD.lifecycle_status||'/'||OLD.collection_onboarding_status,
    NEW.lifecycle_status||'/'||NEW.collection_onboarding_status,
    (SELECT reason_code FROM source_registry_mutation_permit_v1 WHERE source_id=NEW.source_id AND expected_revision=OLD.revision),NEW.current_request_hash,NEW.updated_at
  );
  INSERT INTO source_registry_outbox_v1
  SELECT 'source-outbox-'||NEW.current_operation_id,NEW.source_id,NEW.current_operation_id,NEW.revision,'pending',NULL,NULL,0,
    NEW.current_request_hash,NEW.updated_at,NEW.updated_at
  WHERE OLD.enabled=0 AND NEW.enabled=1;
  UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=NEW.current_request_hash,
    reason_code=(SELECT reason_code FROM source_registry_mutation_permit_v1 WHERE operation_id=NEW.current_operation_id),updated_at=NEW.updated_at
  WHERE operation_id=NEW.current_operation_id AND state='authorized';
  INSERT INTO internal_operation_audit(event_id,operation_id,event_type,actor_ref,event_json,previous_event_hash,event_hash,created_at)
  SELECT 'source-registry-'||NEW.current_operation_id,NEW.current_operation_id,'operation_succeeded','admin_http',
    json_object('sourceId',NEW.source_id,'revision',NEW.revision,'action',(SELECT action FROM source_registry_mutation_permit_v1 WHERE operation_id=NEW.current_operation_id)),
    (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1),NEW.current_request_hash,NEW.updated_at;
END;

CREATE TRIGGER source_registry_update_guard BEFORE UPDATE ON source_registry_v1
WHEN NEW.source_id<>OLD.source_id OR NEW.display_name<>OLD.display_name OR NEW.canonical_feed_url IS NOT OLD.canonical_feed_url
  OR NEW.site_url<>OLD.site_url OR NEW.source_kind<>OLD.source_kind OR NEW.collection_mode<>OLD.collection_mode
  OR NEW.identity_sha256<>OLD.identity_sha256 OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
  OR NOT EXISTS(
    SELECT 1 FROM source_registry_mutation_permit_v1 p
    JOIN internal_operation op ON op.operation_id=p.operation_id
    JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
    WHERE p.operation_id=NEW.current_operation_id AND p.source_id=OLD.source_id AND p.expected_revision=OLD.revision
      AND p.consumed_at IS NULL AND p.request_hash=NEW.current_request_hash
      AND op.state='authorized' AND op.updated_at=p.created_at AND op.request_hash=p.request_hash
      AND h.consumed_by_operation_id=op.operation_id AND h.expires_at>NEW.updated_at
      AND NEW.source_config_epoch=op.source_config_epoch AND NEW.source_safety_epoch=op.source_safety_epoch
      AND NEW.authorization_version=op.authorization_version AND NEW.policy_epoch=op.policy_epoch AND NEW.recovery_epoch=op.recovery_epoch
      AND NEW.updated_at=p.created_at
      AND ((p.action='validate' AND OLD.source_kind='rss' AND OLD.lifecycle_status='proposed' AND OLD.collection_onboarding_status='validating'
          AND NEW.lifecycle_status='proposed' AND NEW.collection_onboarding_status IN('activation_pending','normalization_failed','dedup_needs_review','linked_existing') AND OLD.enabled=0 AND NEW.enabled=0
          AND NEW.source_stop_status=OLD.source_stop_status
          AND ((NEW.collection_onboarding_status='normalization_failed' AND (NEW.canonical_url_valid=0 OR NEW.normalization_status='invalid'))
            OR (NEW.collection_onboarding_status='dedup_needs_review' AND NEW.canonical_url_valid=1 AND NEW.normalization_status='valid' AND NEW.dedup_status='needs_review')
            OR (NEW.collection_onboarding_status='linked_existing' AND NEW.canonical_url_valid=1 AND NEW.normalization_status='valid' AND NEW.dedup_status='linked_existing')
            OR (NEW.collection_onboarding_status='activation_pending' AND NEW.canonical_url_valid=1 AND NEW.normalization_status='valid' AND NEW.dedup_status='unique')))
        OR (p.action='requeue' AND OLD.source_kind='rss' AND OLD.lifecycle_status='proposed' AND OLD.collection_onboarding_status IN('normalization_failed','dedup_needs_review')
          AND NEW.lifecycle_status='proposed' AND NEW.collection_onboarding_status='validating' AND OLD.enabled=0 AND NEW.enabled=0
          AND NEW.canonical_url_valid=OLD.canonical_url_valid AND NEW.normalization_status=OLD.normalization_status AND NEW.dedup_status=OLD.dedup_status
          AND NEW.identity_status=OLD.identity_status AND NEW.relevance_status=OLD.relevance_status AND NEW.monitorability=OLD.monitorability
          AND NEW.adapter_status=OLD.adapter_status AND NEW.adapter_authorization_status=OLD.adapter_authorization_status
          AND NEW.authorization_expires_at IS OLD.authorization_expires_at AND NEW.platform_allowed=OLD.platform_allowed AND NEW.source_stop_status=OLD.source_stop_status)
        OR (p.action='requeue' AND OLD.source_kind IN('rss','x_page') AND OLD.lifecycle_status='paused' AND OLD.collection_onboarding_status IN('stopped','cancelled','dead_letter')
          AND NEW.lifecycle_status='paused' AND NEW.collection_onboarding_status='activation_pending' AND OLD.enabled=0 AND NEW.enabled=0
          AND NEW.canonical_url_valid=OLD.canonical_url_valid AND NEW.normalization_status=OLD.normalization_status AND NEW.dedup_status=OLD.dedup_status
          AND NEW.identity_status=OLD.identity_status AND NEW.relevance_status=OLD.relevance_status AND NEW.monitorability=OLD.monitorability
          AND NEW.adapter_status=OLD.adapter_status AND NEW.adapter_authorization_status=OLD.adapter_authorization_status
          AND NEW.authorization_expires_at IS OLD.authorization_expires_at AND NEW.platform_allowed=OLD.platform_allowed AND NEW.source_stop_status='clear')
        OR (p.action='enable' AND OLD.lifecycle_status IN('proposed','paused') AND OLD.collection_onboarding_status='activation_pending'
          AND NEW.lifecycle_status='active' AND NEW.collection_onboarding_status='queued' AND OLD.enabled=0 AND NEW.enabled=1
          AND NEW.canonical_url_valid=OLD.canonical_url_valid AND NEW.normalization_status=OLD.normalization_status AND NEW.dedup_status=OLD.dedup_status
          AND NEW.identity_status=OLD.identity_status AND NEW.relevance_status=OLD.relevance_status AND NEW.monitorability=OLD.monitorability
          AND NEW.adapter_status=OLD.adapter_status AND NEW.adapter_authorization_status=OLD.adapter_authorization_status
          AND NEW.authorization_expires_at IS OLD.authorization_expires_at AND NEW.platform_allowed=OLD.platform_allowed
          AND NEW.canonical_url_valid=1 AND NEW.normalization_status='valid' AND NEW.dedup_status='unique'
          AND NEW.identity_status IN('unknown','verified') AND NEW.relevance_status IN('unknown','qualified')
          AND NEW.monitorability IN('unknown','monitorable') AND NEW.adapter_status='ready'
          AND NEW.adapter_authorization_status='valid' AND unixepoch(NEW.authorization_expires_at)>unixepoch(NEW.updated_at)
          AND NEW.platform_allowed='allowed' AND NEW.source_stop_status='clear'
          AND EXISTS(SELECT 1 FROM internal_control c WHERE c.singleton_id=1 AND c.phase='paused' AND c.recovery_state='ready'
            AND c.global_stop_state='clear' AND c.emergency_stop_state='clear'
            AND c.source_config_epoch=NEW.source_config_epoch AND c.source_safety_epoch=NEW.source_safety_epoch
            AND c.authorization_version=NEW.authorization_version AND c.policy_epoch=NEW.policy_epoch AND c.recovery_epoch=NEW.recovery_epoch
            AND op.expected_writer_epoch=c.writer_epoch))
        OR (p.action='disable' AND OLD.lifecycle_status='active' AND OLD.collection_onboarding_status IN('queued','collecting','active') AND NEW.lifecycle_status='paused'
          AND NEW.enabled=0 AND NEW.collection_onboarding_status IN('stopped','cancelled')
          AND NEW.canonical_url_valid=OLD.canonical_url_valid AND NEW.normalization_status=OLD.normalization_status AND NEW.dedup_status=OLD.dedup_status
          AND NEW.identity_status=OLD.identity_status AND NEW.relevance_status=OLD.relevance_status AND NEW.monitorability=OLD.monitorability
          AND NEW.adapter_status=OLD.adapter_status AND NEW.adapter_authorization_status=OLD.adapter_authorization_status
          AND NEW.authorization_expires_at IS OLD.authorization_expires_at AND NEW.platform_allowed=OLD.platform_allowed AND NEW.source_stop_status='manual')
        OR (p.action='retire' AND OLD.lifecycle_status='active' AND OLD.collection_onboarding_status IN('queued','collecting','active') AND NEW.lifecycle_status='retired'
          AND NEW.enabled=0 AND NEW.collection_onboarding_status='cancelled'
          AND NEW.canonical_url_valid=OLD.canonical_url_valid AND NEW.normalization_status=OLD.normalization_status AND NEW.dedup_status=OLD.dedup_status
          AND NEW.identity_status=OLD.identity_status AND NEW.relevance_status=OLD.relevance_status AND NEW.monitorability=OLD.monitorability
          AND NEW.adapter_status=OLD.adapter_status AND NEW.adapter_authorization_status=OLD.adapter_authorization_status
          AND NEW.authorization_expires_at IS OLD.authorization_expires_at AND NEW.platform_allowed=OLD.platform_allowed AND NEW.source_stop_status='manual'))
  )
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_TRANSITION_INVALID'); END;

DROP TRIGGER internal_operation_authorize_guard;

DROP INDEX internal_operation_entity_idx;

DROP TRIGGER internal_operation_fence_terminal_guard;

DROP TRIGGER internal_operation_insert_guard;

DROP TRIGGER internal_operation_no_delete;

DROP INDEX internal_operation_state_owner_idx;

DROP TRIGGER internal_operation_transition_guard;

ALTER TABLE internal_operation RENAME TO internal_operation_pre_0013;

CREATE TABLE internal_operation (
  operation_id TEXT PRIMARY KEY CHECK(length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN (
    'x_page_source_update','collect','refine','review','publish','reconcile','projection','backfill',
    'source_create','source_update','source_delete','system_producer','phase_control',
    'backup','restore','withdraw'
  )),
  owner_process TEXT NOT NULL CHECK(owner_process IN (
    'x_page_importer','rss_collector','rss_refiner','automatic_reviewer','automatic_publisher',
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

INSERT INTO internal_operation SELECT * FROM internal_operation_pre_0013;

DROP TABLE internal_operation_pre_0013;

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

CREATE INDEX internal_operation_entity_idx
  ON internal_operation(source_id,candidate_id,publication_id,operation_id);

CREATE TRIGGER internal_operation_fence_terminal_guard
BEFORE UPDATE OF state ON internal_operation
WHEN NEW.state='succeeded' AND EXISTS(SELECT 1 FROM operation_fence_binding f
  JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
  WHERE f.operation_id=NEW.operation_id AND (f.postchecked_at IS NULL
    OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
    OR receipt.policy_epoch<>NEW.policy_epoch OR receipt.recovery_epoch<>NEW.recovery_epoch
    OR receipt.writer_epoch<>NEW.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.updated_at)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_POSTCHECK_REQUIRED'); END;

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

CREATE TRIGGER internal_operation_no_delete
BEFORE DELETE ON internal_operation BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_IMMUTABLE'); END;

CREATE INDEX internal_operation_state_owner_idx
  ON internal_operation(state,owner_process,updated_at,operation_id);

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

DROP TRIGGER operation_entity_binding_insert_guard;

DROP TRIGGER operation_entity_binding_no_delete;

DROP TRIGGER operation_entity_binding_no_update;

ALTER TABLE operation_entity_binding RENAME TO operation_entity_binding_pre_0013;

CREATE TABLE operation_entity_binding (
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'x_page_capture','source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
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

INSERT INTO operation_entity_binding SELECT * FROM operation_entity_binding_pre_0013;

DROP TABLE operation_entity_binding_pre_0013;

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

CREATE TRIGGER operation_entity_binding_no_delete BEFORE DELETE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;

CREATE TRIGGER operation_entity_binding_no_update BEFORE UPDATE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;

DROP TRIGGER gateway_write_permit_insert_guard;

DROP TRIGGER gateway_write_permit_no_delete;

DROP INDEX gateway_write_permit_pending_entity_idx;

DROP TRIGGER gateway_write_permit_update_guard;

ALTER TABLE gateway_write_permit RENAME TO gateway_write_permit_pre_0013;

CREATE TABLE gateway_write_permit (
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'x_page_capture','source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
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

INSERT INTO gateway_write_permit SELECT * FROM gateway_write_permit_pre_0013;

DROP TABLE gateway_write_permit_pre_0013;

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

CREATE TRIGGER gateway_write_permit_no_delete BEFORE DELETE ON gateway_write_permit BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;

CREATE UNIQUE INDEX gateway_write_permit_pending_entity_idx
  ON gateway_write_permit(entity_kind,entity_id,mutation_kind) WHERE consumed_at IS NULL;

CREATE TRIGGER gateway_write_permit_update_guard BEFORE UPDATE ON gateway_write_permit
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.entity_kind<>OLD.entity_kind OR NEW.entity_id<>OLD.entity_id OR NEW.mutation_kind<>OLD.mutation_kind
  OR NEW.expected_entity_version IS NOT OLD.expected_entity_version OR NEW.expected_entity_hash<>OLD.expected_entity_hash
  OR NEW.created_at<>OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;

DROP TRIGGER internal_operation_policy_no_insert;
INSERT INTO internal_operation_policy VALUES
('p-x-page-source-update-paused','admin_http','x_page_source_update','control','paused','none','source',0,0,'ready','not_applicable','not_applicable','not_applicable'),
('p-x-page-import-live','x_page_importer','collect','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','not_applicable','not_applicable');
CREATE TRIGGER internal_operation_policy_no_insert BEFORE INSERT ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
DROP TRIGGER gateway_entity_policy_no_insert;
INSERT INTO gateway_entity_policy VALUES
('x_page_source_update','control','source','update','source_id'),
('collect','db_mutation','candidate','insert','candidate_id'),
('collect','db_mutation','candidate','update','candidate_id'),
('collect','db_mutation','x_page_capture','insert','bound_child');
CREATE TRIGGER gateway_entity_policy_no_insert BEFORE INSERT ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;


-- Rebind only source management to the successor, closed by default. The prior
-- capability row and its unchanged audit/permit history are retained as evidence.
DROP TRIGGER quick_launch_authority_no_delete;
DROP TRIGGER quick_launch_authority_no_insert;
DROP TRIGGER quick_launch_authority_transition_consume;
DROP TRIGGER quick_launch_authority_transition_guard;
ALTER TABLE quick_launch_authority_v2 RENAME TO quick_launch_authority_pre_0013;
CREATE TABLE quick_launch_authority_v2(
  capability_id TEXT PRIMARY KEY CHECK(capability_id IN('bilingual_auto_refine','bilingual_manual_mutation','source_registry_management')),
  schema_sha256 TEXT NOT NULL CHECK(length(schema_sha256)=64 AND schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN('closed','enabled')),
  version INTEGER NOT NULL CHECK(version>=1),
  updated_by_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  authority_receipt_sha256 TEXT CHECK(authority_receipt_sha256 IS NULL OR (length(authority_receipt_sha256)=64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*')),
  updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at),
  CHECK((version=1 AND state='closed' AND updated_by_operation_id IS NULL AND authority_receipt_sha256 IS NULL)
    OR (version>1 AND updated_by_operation_id IS NOT NULL AND authority_receipt_sha256 IS NOT NULL)
    OR (capability_id='source_registry_management' AND state='closed' AND updated_by_operation_id IS NULL AND authority_receipt_sha256 IS NULL))
) STRICT;
INSERT INTO quick_launch_authority_v2 SELECT * FROM quick_launch_authority_pre_0013;
DROP TABLE quick_launch_authority_pre_0013;
UPDATE quick_launch_authority_v2 SET schema_sha256=(SELECT target_schema_sha256 FROM migration_0013_manifest),
 state='closed',version=version+1,updated_by_operation_id=NULL,authority_receipt_sha256=NULL,
 updated_at=(SELECT applied_at FROM migration_0013_manifest) WHERE capability_id='source_registry_management';
CREATE TRIGGER quick_launch_authority_no_delete BEFORE DELETE ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;
CREATE TRIGGER quick_launch_authority_no_insert BEFORE INSERT ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;
CREATE TRIGGER quick_launch_authority_transition_consume AFTER UPDATE ON quick_launch_authority_v2
BEGIN
  UPDATE quick_launch_authority_permit_v2 SET consumed_at=NEW.updated_at
  WHERE operation_id=NEW.updated_by_operation_id
    AND capability_id=NEW.capability_id AND expected_version=OLD.version AND consumed_at IS NULL;
  INSERT INTO bilingual_authority_bridge_marker_v1(bridge_id,operation_id,action,target_schema_sha256,authority_receipt_sha256,created_at,consumed_at)
  SELECT 'bridge-marker-'||p.permit_id,p.operation_id,'enable',NEW.schema_sha256,p.authority_receipt_sha256,p.created_at,NULL
  FROM quick_launch_authority_permit_v2 p
  WHERE p.operation_id=NEW.updated_by_operation_id AND p.capability_id=NEW.capability_id
    AND NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='enabled'
    AND (SELECT status FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1')='closed'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_auto_refine')='enabled'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_manual_mutation')='enabled';
  INSERT INTO bilingual_authority_permit_v1(
    permit_id,operation_id,action,expected_version,target_schema_sha256,extension_sha256,one_time_nonce,
    request_hash,authority_receipt_sha256,created_at,consumed_at
  )
  SELECT 'bridge-'||p.permit_id,p.operation_id,'enable',a.version,NEW.schema_sha256,NEW.schema_sha256,
    p.one_time_nonce,p.request_hash,p.authority_receipt_sha256,p.created_at,NULL
  FROM quick_launch_authority_permit_v2 p JOIN bilingual_authority_capability_v1 a ON a.capability_id='bilingual-v1'
  WHERE p.operation_id=NEW.updated_by_operation_id AND p.capability_id=NEW.capability_id
    AND NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='enabled'
    AND a.status='closed'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_auto_refine')='enabled'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_manual_mutation')='enabled';
  UPDATE bilingual_authority_capability_v1
  SET enabled=1,status='enabled',reason_code='READY',extension_sha256=NEW.schema_sha256,version=version+1,
    updated_by_operation_id=NEW.updated_by_operation_id,authority_receipt_sha256=NEW.authority_receipt_sha256,updated_at=NEW.updated_at
  WHERE NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='enabled'
    AND status='closed'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_auto_refine')='enabled'
    AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id='bilingual_manual_mutation')='enabled';
  INSERT INTO bilingual_authority_bridge_marker_v1(bridge_id,operation_id,action,target_schema_sha256,authority_receipt_sha256,created_at,consumed_at)
  SELECT 'bridge-marker-'||p.permit_id,p.operation_id,'close',NEW.schema_sha256,p.authority_receipt_sha256,p.created_at,NULL
  FROM quick_launch_authority_permit_v2 p
  WHERE p.operation_id=NEW.updated_by_operation_id AND p.capability_id=NEW.capability_id
    AND NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='closed'
    AND (SELECT status FROM bilingual_authority_capability_v1 WHERE capability_id='bilingual-v1')='enabled';
  INSERT INTO bilingual_authority_permit_v1(
    permit_id,operation_id,action,expected_version,target_schema_sha256,extension_sha256,one_time_nonce,
    request_hash,authority_receipt_sha256,created_at,consumed_at
  )
  SELECT 'bridge-'||p.permit_id,p.operation_id,'close',a.version,NEW.schema_sha256,a.extension_sha256,
    p.one_time_nonce,p.request_hash,p.authority_receipt_sha256,p.created_at,NULL
  FROM quick_launch_authority_permit_v2 p JOIN bilingual_authority_capability_v1 a ON a.capability_id='bilingual-v1'
  WHERE p.operation_id=NEW.updated_by_operation_id AND p.capability_id=NEW.capability_id
    AND NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='closed'
    AND a.status='enabled';
  UPDATE bilingual_authority_capability_v1
  SET enabled=0,status='closed',reason_code='AUTHORITY_EXTENSION_REQUIRED',version=version+1,
    updated_by_operation_id=NEW.updated_by_operation_id,authority_receipt_sha256=NEW.authority_receipt_sha256,updated_at=NEW.updated_at
  WHERE NEW.capability_id IN('bilingual_auto_refine','bilingual_manual_mutation') AND NEW.state='closed'
    AND status='enabled';
  INSERT INTO quick_launch_authority_audit_v2 VALUES(
    'authority-'||NEW.capability_id||'-v'||NEW.version,NEW.capability_id,OLD.state,NEW.state,
    OLD.version,NEW.version,NEW.updated_by_operation_id,
    (SELECT permit_id FROM quick_launch_authority_permit_v2 WHERE capability_id=NEW.capability_id AND expected_version=OLD.version),
    COALESCE(NEW.authority_receipt_sha256,OLD.authority_receipt_sha256),NEW.updated_at
  );
  UPDATE internal_operation SET state='succeeded',version=version+1,result_hash=NEW.authority_receipt_sha256,
    reason_code='AUTHORITY_TRANSITION_COMMITTED',updated_at=NEW.updated_at
  WHERE operation_id=NEW.updated_by_operation_id AND state='authorized';
  INSERT INTO internal_operation_audit(event_id,operation_id,event_type,actor_ref,event_json,previous_event_hash,event_hash,created_at)
  SELECT 'authority-v2-'||NEW.capability_id||'-v'||NEW.version,NEW.updated_by_operation_id,'operation_succeeded','admin_http',
    json_object('capabilityId',NEW.capability_id,'state',NEW.state,'version',NEW.version),
    (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1),NEW.authority_receipt_sha256,NEW.updated_at
  WHERE NOT EXISTS(SELECT 1 FROM internal_operation_audit WHERE operation_id=NEW.updated_by_operation_id AND event_type='operation_succeeded');
END;
CREATE TRIGGER quick_launch_authority_transition_guard BEFORE UPDATE ON quick_launch_authority_v2
WHEN NEW.capability_id<>OLD.capability_id OR NEW.schema_sha256<>OLD.schema_sha256 OR NEW.version<>OLD.version+1
  OR NOT ((OLD.state='closed' AND NEW.state='enabled') OR (OLD.state='enabled' AND NEW.state='closed'))
  OR NOT EXISTS(
    SELECT 1 FROM quick_launch_authority_permit_v2 p
    WHERE p.operation_id=NEW.updated_by_operation_id AND p.capability_id=NEW.capability_id
      AND p.expected_version=OLD.version AND p.consumed_at IS NULL
      AND ((p.action='enable' AND NEW.state='enabled') OR (p.action='close' AND NEW.state='closed'))
      AND p.created_at=NEW.updated_at AND p.authority_receipt_sha256=NEW.authority_receipt_sha256
  )
  OR NEW.updated_by_operation_id IS NULL OR NEW.authority_receipt_sha256 IS NULL
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_TRANSITION_INVALID'); END;

CREATE TABLE x_page_migration_identity_v1(
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 selection_sha256 TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 previous_registry_json TEXT NOT NULL CHECK(json_valid(previous_registry_json)),
 previous_authority_json TEXT NOT NULL CHECK(json_valid(previous_authority_json)),
 evidence_class TEXT NOT NULL CHECK(evidence_class='synthetic_clone'),
 applied_at TEXT NOT NULL
) STRICT;
INSERT INTO x_page_migration_identity_v1
SELECT 1,selection_sha256,manifest_json,previous_registry_json,previous_authority_json,'synthetic_clone',applied_at FROM migration_0013_manifest;
CREATE TABLE x_page_source_config_v1(
 source_id TEXT PRIMARY KEY REFERENCES source_registry_v1(source_id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=2),
 canonical_handle TEXT NOT NULL UNIQUE,
 canonical_page_url TEXT NOT NULL UNIQUE,
 identity_sha256 TEXT NOT NULL CHECK(length(identity_sha256)=64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'),
 selection_sha256 TEXT NOT NULL,
 schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds>=900),
 concurrency INTEGER NOT NULL CHECK(concurrency=1),
 adapter_sha256 TEXT NOT NULL,
 authorization_receipt_sha256 TEXT NOT NULL,
 authorization_expires_at TEXT NOT NULL,
 source_policy_sha256 TEXT NOT NULL,
 rights_status TEXT NOT NULL CHECK(rights_status='unknown'),
 media_policy TEXT NOT NULL CHECK(media_policy='blocked'),
 evidence_class TEXT NOT NULL CHECK(evidence_class='synthetic_clone')
) STRICT;
INSERT INTO x_page_source_config_v1
SELECT s.source_id,r.revision,s.canonical_handle,r.site_url,s.identity_sha256,m.selection_sha256,900,1,
 m.adapter_sha256,m.authorization_receipt_sha256,m.authorization_expires_at,m.source_policy_sha256,'unknown','blocked','synthetic_clone'
FROM migration_0013_source s JOIN source_registry_v1 r ON r.source_id=s.source_id CROSS JOIN migration_0013_manifest m;
CREATE TABLE x_page_candidate_capture_v1(
 capture_id TEXT PRIMARY KEY,
 candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 source_id TEXT NOT NULL REFERENCES x_page_source_config_v1(source_id),
 status_id TEXT NOT NULL CHECK(length(status_id) BETWEEN 15 AND 20 AND status_id NOT GLOB '*[^0-9]*'),
 author_handle TEXT NOT NULL,
 source_version_hash TEXT NOT NULL CHECK(length(source_version_hash)=64 AND source_version_hash NOT GLOB '*[^0-9a-f]*'),
 complete_text TEXT NOT NULL CHECK(length(complete_text) BETWEEN 1 AND 25000),
 normalized_json TEXT NOT NULL CHECK(json_valid(normalized_json)),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
 observed_at TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id),
 UNIQUE(candidate_id,source_revision),
 UNIQUE(candidate_id,source_version_hash)
) STRICT;
CREATE INDEX x_page_status_capture_idx ON x_page_candidate_capture_v1(status_id,source_revision);
CREATE TRIGGER x_page_capture_insert_guard BEFORE INSERT ON x_page_candidate_capture_v1
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN pending_review_candidate c ON c.candidate_id=NEW.candidate_id
 JOIN x_page_source_config_v1 config ON config.source_id=NEW.source_id
 WHERE p.entity_kind='x_page_capture' AND p.entity_id=NEW.capture_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
 AND op.operation_id=NEW.operation_id AND op.owner_process='x_page_importer' AND op.source_id=NEW.source_id AND op.candidate_id=NEW.candidate_id
 AND c.source_id=NEW.source_id AND c.external_id=NEW.status_id AND c.source_revision=NEW.source_revision AND c.source_payload_hash=NEW.source_version_hash
 AND config.canonical_handle=NEW.author_handle AND json_extract(NEW.normalized_json,'$.text')=NEW.complete_text
 AND json_extract(NEW.normalized_json,'$.sourceVersionHash')=NEW.source_version_hash
 AND json_extract(NEW.normalized_json,'$.statusId')=NEW.status_id)
 OR EXISTS(SELECT 1 FROM x_page_candidate_capture_v1 old WHERE old.status_id=NEW.status_id AND (old.author_handle<>NEW.author_handle OR old.candidate_id<>NEW.candidate_id))
BEGIN SELECT RAISE(ABORT,'X_PAGE_CAPTURE_BINDING_INVALID'); END;
CREATE TRIGGER x_page_capture_no_update BEFORE UPDATE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CAPTURE_IMMUTABLE'); END;
CREATE TRIGGER x_page_capture_no_delete BEFORE DELETE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CAPTURE_IMMUTABLE'); END;
CREATE TRIGGER x_page_config_no_insert BEFORE INSERT ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER x_page_config_no_update BEFORE UPDATE ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER x_page_config_no_delete BEFORE DELETE ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER x_page_identity_no_insert BEFORE INSERT ON x_page_migration_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER x_page_identity_no_update BEFORE UPDATE ON x_page_migration_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER x_page_identity_no_delete BEFORE DELETE ON x_page_migration_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER x_page_candidate_insert_guard BEFORE INSERT ON pending_review_candidate
WHEN EXISTS(SELECT 1 FROM source WHERE source_id=NEW.source_id AND source_kind='x_page') AND (
 NEW.review_status<>'pending_review' OR NEW.source_revision<>1 OR NEW.editor_title IS NOT NULL OR NEW.editor_excerpt IS NOT NULL
 OR NEW.editor_notes IS NOT NULL OR NEW.editor_based_on_source_revision IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 WHERE p.entity_kind='candidate' AND p.entity_id=NEW.candidate_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
 AND op.owner_process='x_page_importer' AND op.source_id=NEW.source_id AND op.candidate_id=NEW.candidate_id))
BEGIN SELECT RAISE(ABORT,'X_PAGE_CANDIDATE_IMPORT_REQUIRED'); END;
CREATE TRIGGER x_page_import_update_guard BEFORE UPDATE ON pending_review_candidate
WHEN EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 WHERE p.entity_kind='candidate' AND p.entity_id=OLD.candidate_id AND p.mutation_kind='update' AND p.consumed_at IS NULL AND op.owner_process='x_page_importer') AND (
 NEW.source_id<>OLD.source_id OR NEW.external_id<>OLD.external_id OR NEW.dedupe_key<>OLD.dedupe_key OR NEW.candidate_id<>OLD.candidate_id
 OR NEW.first_seen_at<>OLD.first_seen_at OR NEW.canonical_url<>OLD.canonical_url OR NEW.published_at<>OLD.published_at
 OR NEW.editor_title IS NOT OLD.editor_title OR NEW.editor_excerpt IS NOT OLD.editor_excerpt OR NEW.editor_notes IS NOT OLD.editor_notes
 OR NEW.editor_based_on_source_revision IS NOT OLD.editor_based_on_source_revision
 OR NEW.source_revision<>OLD.source_revision+1 OR NEW.review_status<>CASE WHEN OLD.review_status='rejected' THEN 'rejected' ELSE 'pending_review' END
 OR NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 WHERE p.entity_kind='candidate' AND p.entity_id=OLD.candidate_id AND p.mutation_kind='update' AND p.consumed_at IS NULL
 AND op.owner_process='x_page_importer' AND op.source_id=OLD.source_id AND op.candidate_id=OLD.candidate_id
 AND p.expected_entity_version=OLD.source_revision AND p.expected_entity_hash=OLD.source_payload_hash))
BEGIN SELECT RAISE(ABORT,'X_PAGE_IMPORT_UPDATE_INVALID'); END;
CREATE TRIGGER x_page_import_terminal_guard BEFORE UPDATE OF state ON internal_operation
WHEN NEW.owner_process='x_page_importer' AND NEW.state='succeeded' AND NOT EXISTS(
 SELECT 1 FROM pending_review_candidate c JOIN x_page_candidate_capture_v1 capture ON capture.candidate_id=c.candidate_id
 WHERE c.candidate_id=NEW.candidate_id AND c.source_id=NEW.source_id AND capture.source_revision=c.source_revision
 AND capture.source_version_hash=c.source_payload_hash)
BEGIN SELECT RAISE(ABORT,'X_PAGE_IMPORT_CAPTURE_MISSING'); END;
PRAGMA user_version=11;

-- Import capabilities cannot target an RSS row or silently use a stale source binding.
CREATE TRIGGER x_page_import_source_authority_guard BEFORE UPDATE OF state ON internal_operation
WHEN NEW.owner_process='x_page_importer' AND NEW.state IN('authorized','succeeded') AND NOT EXISTS(
 SELECT 1 FROM source_registry_v1 r JOIN source s ON s.source_id=r.source_id
 JOIN x_page_source_config_v1 config ON config.source_id=r.source_id
 JOIN operation_entity_binding binding ON binding.operation_id=NEW.operation_id AND binding.entity_kind='source' AND binding.entity_id=r.source_id
 WHERE r.source_id=NEW.source_id AND r.source_kind='x_page' AND r.collection_mode='browser_visible_dom'
 AND s.source_kind='x_page' AND s.feed_url IS NULL AND s.enabled=1 AND s.stop_epoch=NEW.source_stop_epoch
 AND r.enabled=1 AND r.lifecycle_status='active' AND r.source_stop_status='clear'
 AND r.identity_status='verified' AND r.adapter_status='ready' AND r.adapter_authorization_status='valid' AND r.platform_allowed='allowed'
 AND r.identity_sha256=config.identity_sha256 AND binding.expected_entity_version=r.revision AND binding.expected_entity_hash=r.identity_sha256
 AND r.source_config_epoch=NEW.source_config_epoch AND r.source_safety_epoch=NEW.source_safety_epoch
 AND r.authorization_version=NEW.authorization_version AND r.policy_epoch=NEW.policy_epoch AND r.recovery_epoch=NEW.recovery_epoch
 AND unixepoch(r.authorization_expires_at)>unixepoch(NEW.updated_at) AND unixepoch(config.authorization_expires_at)>unixepoch(NEW.updated_at)
)
BEGIN SELECT RAISE(ABORT,'X_PAGE_SOURCE_AUTHORITY_INVALID'); END;

DROP TRIGGER source_registry_mutation_permit_insert_guard;
CREATE TRIGGER source_registry_mutation_permit_insert_guard BEFORE INSERT ON source_registry_mutation_permit_v1
WHEN (EXISTS(SELECT 1 FROM source_registry_v1 r WHERE r.source_id=NEW.source_id AND r.source_kind='x_page')
 AND NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id AND op.operation_kind='x_page_source_update' AND op.policy_id='p-x-page-source-update-paused'))
 OR NOT EXISTS(
  SELECT 1 FROM quick_launch_authority_v2 a
  JOIN internal_operation op ON op.operation_id=NEW.operation_id
  JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
  JOIN internal_control c ON c.singleton_id=1
  WHERE a.capability_id='source_registry_management' AND a.state='enabled'
    AND (NEW.action IN('propose','validate','requeue','disable','retire') OR EXISTS(
      SELECT 1 FROM quick_launch_authority_audit_v2 qa
      JOIN quick_launch_authority_permit_v2 qp ON qp.permit_id=qa.permit_id
      JOIN internal_operation qop ON qop.operation_id=qa.operation_id
      JOIN owner_authorization_handoff qh ON qh.handoff_id=qop.authorization_handoff_id
      WHERE qa.capability_id='source_registry_management' AND qa.to_state='enabled'
        AND qa.to_version=a.version AND qa.receipt_sha256=a.authority_receipt_sha256
        AND qp.action='enable' AND qp.consumed_at=qa.created_at
        AND qp.authority_receipt_sha256=qa.receipt_sha256
        AND qop.state='succeeded' AND qop.result_hash=qa.receipt_sha256
        AND qop.phase='disabled' AND qop.egress_class='none' AND qop.expected_schema_sha256=a.schema_sha256
        AND qh.owner_process='admin_http' AND qh.consumed_by_operation_id=qop.operation_id
    ))
    AND op.state='authorized' AND op.owner_process='admin_http' AND op.egress_class='none'
    AND h.consumed_by_operation_id=op.operation_id AND op.source_id=NEW.source_id
    AND op.updated_at=NEW.created_at AND h.verified_at<=NEW.created_at AND h.expires_at>NEW.created_at
    AND NEW.request_hash=op.request_hash AND NEW.authorization_ref=op.authorization_handoff_id
    AND c.phase=op.phase AND op.source_config_epoch=c.source_config_epoch AND op.source_safety_epoch=c.source_safety_epoch
    AND op.authorization_version=c.authorization_version AND op.policy_epoch=c.policy_epoch
    AND op.recovery_epoch=c.recovery_epoch AND op.expected_writer_epoch=c.writer_epoch
    AND ((NEW.action IN('propose','validate') AND op.operation_kind='source_create' AND op.policy_id='p-source-create-disabled' AND op.phase='disabled'
          AND ((NEW.action='propose' AND NEW.expected_revision=0) OR (NEW.action='validate' AND NEW.expected_revision>=1)))
      OR (NEW.action IN('requeue','enable','disable') AND op.operation_kind='source_update' AND op.policy_id='p-source-update-paused' AND op.phase='paused')
      OR (NEW.action IN('requeue','enable','disable') AND op.operation_kind='x_page_source_update' AND op.policy_id='p-x-page-source-update-paused' AND op.phase='paused'
          AND EXISTS(SELECT 1 FROM source_registry_v1 r WHERE r.source_id=NEW.source_id AND r.source_kind='x_page')
          AND op.expected_schema_sha256=a.schema_sha256)
      OR (NEW.action='retire' AND op.operation_kind='source_delete' AND op.policy_id='p-source-delete-paused' AND op.phase='paused'))
)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_INVALID'); END;
