-- File-clone structure only. Exact RSS-only 0014 predecessor; runner owns the transaction.
-- All existing triggers are restored verbatim; no X producer capability is admitted.
DROP TRIGGER "gateway_source_delete_guard";
DROP TRIGGER "gateway_source_insert_guard";
DROP TRIGGER "gateway_source_update_guard";
ALTER TABLE source RENAME TO source_pre_0015;
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

INSERT INTO source(source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code) SELECT source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code FROM source_pre_0015;
INSERT INTO source(source_id,feed_url,source_kind,enabled,stop_epoch,last_reason_code) SELECT source_id,NULL,'x_page',0,source_safety_epoch,'X_PAGE_ADMISSION_REQUIRED' FROM source_registry_v1 WHERE source_id IN(SELECT source_id FROM migration_0015_source);
DROP TABLE source_pre_0015;
CREATE TRIGGER gateway_source_delete_guard BEFORE DELETE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='delete' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_insert_guard BEFORE INSERT ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=NEW.source_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_update_guard BEFORE UPDATE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
DROP INDEX "source_registry_list_idx";
DROP TRIGGER "source_registry_insert_effects";
DROP TRIGGER "source_registry_insert_guard";
DROP TRIGGER "source_registry_no_delete";
DROP TRIGGER "source_registry_update_effects";
DROP TRIGGER "source_registry_update_guard";
ALTER TABLE source_registry_v1 RENAME TO source_registry_v1_pre_0015;
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

INSERT INTO source_registry_v1 SELECT * FROM source_registry_v1_pre_0015;
UPDATE source_registry_v1 SET source_kind='x_page',collection_mode='browser_visible_dom',revision=revision+1,
 canonical_url_valid=0,normalization_status='pending',dedup_status='pending',identity_status='unknown',relevance_status='unknown',monitorability='unknown',
 adapter_status='unchecked',adapter_authorization_status='unknown',platform_allowed='unknown',authorization_expires_at=NULL,
 lifecycle_status='proposed',collection_onboarding_status='validating',enabled=0,
 identity_sha256=(SELECT identity_sha256 FROM migration_0015_source WHERE source_id=source_registry_v1.source_id),
 updated_at=(SELECT applied_at FROM migration_0015_manifest)
 WHERE source_id IN(SELECT source_id FROM migration_0015_source);
DROP TABLE source_registry_v1_pre_0015;
CREATE INDEX source_registry_list_idx ON source_registry_v1(lifecycle_status,enabled,updated_at DESC,source_id);
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
CREATE TRIGGER source_registry_no_delete BEFORE DELETE ON source_registry_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RETIRE_IS_STATE_TRANSITION'); END;
CREATE TRIGGER source_registry_update_effects AFTER UPDATE ON source_registry_v1
BEGIN
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
        OR (p.action='requeue' AND OLD.source_kind='rss' AND OLD.lifecycle_status='paused' AND OLD.collection_onboarding_status IN('stopped','cancelled','dead_letter')
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
CREATE TABLE x_page_source_config_v1(
 source_id TEXT PRIMARY KEY REFERENCES source_registry_v1(source_id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=2),
 canonical_handle TEXT NOT NULL UNIQUE,
 canonical_page_url TEXT NOT NULL UNIQUE,
 identity_sha256 TEXT NOT NULL CHECK(length(identity_sha256)=64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'),
 selection_sha256 TEXT NOT NULL,
 schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds>=900),
 concurrency INTEGER NOT NULL CHECK(concurrency=1),
 adapter_sha256 TEXT CHECK(adapter_sha256 IS NULL),
 authorization_receipt_sha256 TEXT CHECK(authorization_receipt_sha256 IS NULL),
 authorization_expires_at TEXT CHECK(authorization_expires_at IS NULL),
 source_policy_sha256 TEXT CHECK(source_policy_sha256 IS NULL),
 rights_status TEXT NOT NULL CHECK(rights_status='unknown'),
 media_policy TEXT NOT NULL CHECK(media_policy='blocked'),
 evidence_class TEXT NOT NULL CHECK(evidence_class='file_clone_structure_only')
) STRICT;
INSERT INTO x_page_source_config_v1
SELECT s.source_id,r.revision,s.canonical_handle,'https://x.com/'||s.canonical_handle,s.identity_sha256,m.selection_sha256,900,1,
 NULL,NULL,NULL,NULL,'unknown','blocked','file_clone_structure_only'
FROM migration_0015_source s JOIN source_registry_v1 r ON r.source_id=s.source_id CROSS JOIN migration_0015_manifest m;
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
 normalized_sha256 TEXT NOT NULL CHECK(length(normalized_sha256)=64 AND normalized_sha256 NOT GLOB '*[^0-9a-f]*'),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
 observed_at TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id),
 UNIQUE(candidate_id,source_revision),
 UNIQUE(candidate_id,source_version_hash)
) STRICT;
CREATE INDEX x_page_status_capture_idx ON x_page_candidate_capture_v1(status_id,source_revision);
CREATE TABLE x_page_file_clone_identity_v1(
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 predecessor_schema_sha256 TEXT NOT NULL CHECK(length(predecessor_schema_sha256)=64),
 migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256)=64),
 target_schema_sha256 TEXT NOT NULL CHECK(length(target_schema_sha256)=64),
 selection_sha256 TEXT NOT NULL CHECK(length(selection_sha256)=64),
 preserved_history_sha256 TEXT NOT NULL CHECK(length(preserved_history_sha256)=64),
 evidence_class TEXT NOT NULL CHECK(evidence_class='file_clone_structure_only'),
 applied_at TEXT NOT NULL
) STRICT;
INSERT INTO x_page_file_clone_identity_v1 SELECT 1,manifest_json,source_sha256,predecessor_schema_sha256,migration_sha256,target_schema_sha256,selection_sha256,preserved_history_sha256,'file_clone_structure_only',applied_at FROM migration_0015_manifest;
CREATE TRIGGER x_page_source_config_v1_deny_insert BEFORE INSERT ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_source_config_v1_deny_update BEFORE UPDATE ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_source_config_v1_deny_delete BEFORE DELETE ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_file_clone_identity_v1_deny_insert BEFORE INSERT ON x_page_file_clone_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_file_clone_identity_v1_deny_update BEFORE UPDATE ON x_page_file_clone_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_file_clone_identity_v1_deny_delete BEFORE DELETE ON x_page_file_clone_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_candidate_capture_v1_deny_insert BEFORE INSERT ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_candidate_capture_v1_deny_update BEFORE UPDATE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_candidate_capture_v1_deny_delete BEFORE DELETE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_source_update BEFORE UPDATE ON source WHEN OLD.source_kind='x_page' OR NEW.source_kind='x_page' BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_source_registry_v1_update BEFORE UPDATE ON source_registry_v1 WHEN OLD.source_kind='x_page' OR NEW.source_kind='x_page' BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_pending_review_candidate_update BEFORE UPDATE ON pending_review_candidate WHEN EXISTS(SELECT 1 FROM source WHERE source_id IN(OLD.source_id,NEW.source_id) AND source_kind='x_page') BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_source_insert BEFORE INSERT ON source WHEN NEW.source_kind='x_page' BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_source_registry_v1_insert BEFORE INSERT ON source_registry_v1 WHEN NEW.source_kind='x_page' BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_pending_review_candidate_insert BEFORE INSERT ON pending_review_candidate WHEN EXISTS(SELECT 1 FROM source WHERE source_id=NEW.source_id AND source_kind='x_page') BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
CREATE TRIGGER x_page_structure_source_delete BEFORE DELETE ON source WHEN OLD.source_kind='x_page' BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REQUIRED'); END;
PRAGMA user_version=11;
