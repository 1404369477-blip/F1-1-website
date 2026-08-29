-- F1+1 additive migration 0010: unified source registry v1.
--
-- The opener verifies the exact schema-9 preimage and supplies two
-- connection-local TEMP manifests derived from the existing schema-9 RSS and
-- X registries.  The migration never reads a caller-provided source fixture.
-- Runtime mutation starts closed.  The v2 one-time permits below bind the
-- existing Admin gateway/authorizer and bridge bilingual v1 only after both
-- granular bilingual capabilities are enabled.
-- MIGRATION_CANONICAL_SHA256=0421148d7cbe5fb39218f01495d2bd514e61764bc1d20c09051866ac7058cfe3

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0010_assert(value INTEGER NOT NULL CHECK(value=1)) STRICT;
INSERT INTO migration_0010_assert
SELECT CASE WHEN
  (SELECT count(*) FROM migration_0010_preflight)=1
  AND (SELECT source_user_version FROM migration_0010_preflight)=9
  AND (SELECT source_schema_sha256 FROM migration_0010_preflight)='d2460592cb4c6aaec099155ff483224e33706dc6efaafb7a17dc1b22e86121f4'
  AND (SELECT source_0009_raw_sha256 FROM migration_0010_preflight)='d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd'
  AND (SELECT source_0009_canonical_sha256 FROM migration_0010_preflight)='1b6a3814c0ac6ec65cb46eaec5b39a415848f2acc5226d69ac940e995796b273'
  AND length((SELECT target_schema_sha256 FROM migration_0010_preflight))=64
  AND (SELECT apply_enabled FROM migration_0010_preflight)=1
  AND (SELECT count(*) FROM source)=4
  AND (SELECT count(*) FROM source WHERE (source_id,feed_url) IN (
    ('motorsport-f1-news','https://www.motorsport.com/rss/f1/news/'),
    ('autosport-f1-news','https://www.autosport.com/rss/f1/news/'),
    ('racefans-f1-news','https://www.racefans.net/category/formula-1/feed/'),
    ('the-race-f1-news','https://www.the-race.com/category/formula-1/rss/')
  ))=4
  AND (SELECT count(*) FROM x_manual_source_registry)=59
  AND (SELECT count(*) FROM x_manual_source_registry WHERE enabled=0 AND lifecycle_status='proposed' AND collection_mode='manual_url')=59
  AND (SELECT count(DISTINCT inventory_sha256) FROM x_manual_source_registry)=1
  AND (SELECT min(inventory_sha256) FROM x_manual_source_registry)='bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b'
  AND (SELECT count(*) FROM migration_0010_rss_manifest)=4
  AND NOT EXISTS(SELECT 1 FROM source s LEFT JOIN migration_0010_rss_manifest m ON m.source_id=s.source_id WHERE m.source_id IS NULL OR m.feed_url<>s.feed_url OR m.source_config_epoch<>s.stop_epoch OR m.source_safety_epoch<>s.stop_epoch)
  AND (SELECT count(*) FROM migration_0010_x_identity)=59
  AND NOT EXISTS(SELECT 1 FROM x_manual_source_registry x LEFT JOIN migration_0010_x_identity i ON i.source_id=x.source_id WHERE i.source_id IS NULL OR i.canonical_url<>x.canonical_url OR i.handle<>x.handle OR i.inventory_sha256<>x.inventory_sha256)
  AND (SELECT count(*) FROM internal_control)=1
  AND (SELECT count(*) FROM bilingual_authority_capability_v1
    WHERE capability_id='bilingual-v1' AND enabled=0 AND status='closed' AND version=1
      AND extension_sha256 IS NULL AND updated_by_operation_id IS NULL AND authority_receipt_sha256 IS NULL)=1
  AND (SELECT count(*) FROM bilingual_authority_permit_v1)=0
  AND (SELECT count(*) FROM bilingual_authority_audit_v1)=0
  AND (SELECT count(*) FROM bilingual_authority_bridge_marker_v1)=0
  AND NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name IN (
    'quick_launch_authority_v2','quick_launch_authority_permit_v2','quick_launch_authority_audit_v2',
    'source_registry_v1','source_registry_rss_config_v1','source_registry_health_v1',
    'source_registry_history_v1','source_registry_outbox_v1','source_registry_mutation_permit_v1',
    'source_registry_migration_identity_v1'
  ))
  THEN 1 ELSE 0 END;

CREATE TABLE quick_launch_authority_v2(
  capability_id TEXT PRIMARY KEY CHECK(capability_id IN('bilingual_auto_refine','bilingual_manual_mutation','source_registry_management')),
  schema_sha256 TEXT NOT NULL CHECK(length(schema_sha256)=64 AND schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN('closed','enabled')),
  version INTEGER NOT NULL CHECK(version>=1),
  updated_by_operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  authority_receipt_sha256 TEXT CHECK(authority_receipt_sha256 IS NULL OR (length(authority_receipt_sha256)=64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*')),
  updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at),
  CHECK((version=1 AND state='closed' AND updated_by_operation_id IS NULL AND authority_receipt_sha256 IS NULL)
    OR (version>1 AND updated_by_operation_id IS NOT NULL AND authority_receipt_sha256 IS NOT NULL))
) STRICT;
INSERT INTO quick_launch_authority_v2
SELECT 'bilingual_auto_refine',target_schema_sha256,'closed',1,NULL,NULL,'2026-08-24T00:00:00.000Z' FROM migration_0010_preflight
UNION ALL SELECT 'bilingual_manual_mutation',target_schema_sha256,'closed',1,NULL,NULL,'2026-08-24T00:00:00.000Z' FROM migration_0010_preflight
UNION ALL SELECT 'source_registry_management',target_schema_sha256,'closed',1,NULL,NULL,'2026-08-24T00:00:00.000Z' FROM migration_0010_preflight;

CREATE TABLE source_registry_migration_identity_v1(
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
  source_0009_raw_sha256 TEXT NOT NULL CHECK(length(source_0009_raw_sha256)=64 AND source_0009_raw_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_schema9_sha256 TEXT NOT NULL CHECK(length(source_schema9_sha256)=64 AND source_schema9_sha256 NOT GLOB '*[^0-9a-f]*'),
  migration_0010_canonical_sha256 TEXT NOT NULL CHECK(length(migration_0010_canonical_sha256)=64 AND migration_0010_canonical_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  x_inventory_set_sha256 TEXT NOT NULL CHECK(length(x_inventory_set_sha256)=64 AND x_inventory_set_sha256 NOT GLOB '*[^0-9a-f]*'),
  migrated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',migrated_at)=migrated_at)
) STRICT;
INSERT INTO source_registry_migration_identity_v1
SELECT 1,source_0009_raw_sha256,source_schema_sha256,migration_0010_canonical_sha256,manifest_sha256,
  '915a159f735e7d5a7adf1dbe2d4e3fa0509fc6c1766bf31f4123767eaf2d1d5d',migrated_at
FROM migration_0010_preflight;
CREATE TRIGGER source_registry_migration_identity_no_update BEFORE UPDATE ON source_registry_migration_identity_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MIGRATION_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER source_registry_migration_identity_no_delete BEFORE DELETE ON source_registry_migration_identity_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MIGRATION_IDENTITY_IMMUTABLE'); END;

CREATE TABLE quick_launch_authority_permit_v2(
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  capability_id TEXT NOT NULL REFERENCES quick_launch_authority_v2(capability_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN('enable','close')),
  expected_version INTEGER NOT NULL CHECK(expected_version>=1),
  one_time_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(one_time_nonce AS BLOB))=43),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  authority_receipt_sha256 TEXT NOT NULL UNIQUE CHECK(length(authority_receipt_sha256)=64 AND authority_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  consumed_at TEXT CHECK(consumed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',consumed_at)=consumed_at),
  UNIQUE(operation_id,capability_id),
  UNIQUE(capability_id,expected_version)
) STRICT;

CREATE TABLE quick_launch_authority_audit_v2(
  event_id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES quick_launch_authority_v2(capability_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  from_state TEXT NOT NULL CHECK(from_state IN('closed','enabled')),
  to_state TEXT NOT NULL CHECK(to_state IN('closed','enabled')),
  from_version INTEGER NOT NULL CHECK(from_version>=1),
  to_version INTEGER NOT NULL CHECK(to_version=from_version+1),
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  permit_id TEXT NOT NULL UNIQUE REFERENCES quick_launch_authority_permit_v2(permit_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  receipt_sha256 TEXT NOT NULL UNIQUE CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
) STRICT;

CREATE TRIGGER quick_launch_authority_permit_insert_guard BEFORE INSERT ON quick_launch_authority_permit_v2
WHEN NOT EXISTS(
  SELECT 1 FROM internal_operation op
  JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
  JOIN internal_control c ON c.singleton_id=1
  JOIN quick_launch_authority_v2 a ON a.capability_id=NEW.capability_id
  WHERE op.operation_id=NEW.operation_id AND op.state='authorized'
    AND op.owner_process='admin_http' AND op.operation_kind='phase_control'
    AND op.capability_class='control' AND op.policy_id='p-phase-control-disabled'
    AND op.control_action='fence_update' AND op.phase='disabled' AND op.egress_class='none'
    AND op.expected_schema_sha256=a.schema_sha256
    AND NEW.request_hash=op.request_hash
    AND h.consumed_by_operation_id=op.operation_id
    AND op.updated_at=NEW.created_at AND h.verified_at<=NEW.created_at AND h.expires_at>NEW.created_at
    AND c.phase='disabled' AND c.global_stop_state='stopped' AND c.emergency_stop_state='clear'
    AND c.recovery_state='fenced' AND op.source_config_epoch=c.source_config_epoch
    AND op.source_safety_epoch=c.source_safety_epoch AND op.authorization_version=c.authorization_version
    AND op.policy_epoch=c.policy_epoch AND op.recovery_epoch=c.recovery_epoch
    AND op.expected_writer_epoch=c.writer_epoch
    AND a.version=NEW.expected_version
    AND ((NEW.action='enable' AND a.state='closed') OR (NEW.action='close' AND a.state='enabled'))
)
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_PERMIT_INVALID'); END;

CREATE TRIGGER quick_launch_authority_permit_update_guard BEFORE UPDATE ON quick_launch_authority_permit_v2
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.capability_id<>OLD.capability_id OR NEW.action<>OLD.action OR NEW.expected_version<>OLD.expected_version
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.request_hash<>OLD.request_hash
  OR NEW.authority_receipt_sha256<>OLD.authority_receipt_sha256 OR NEW.created_at<>OLD.created_at
  OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_PERMIT_IMMUTABLE'); END;
CREATE TRIGGER quick_launch_authority_permit_no_delete BEFORE DELETE ON quick_launch_authority_permit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_PERMIT_IMMUTABLE'); END;

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
CREATE TRIGGER quick_launch_authority_no_insert BEFORE INSERT ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;
CREATE TRIGGER quick_launch_authority_no_delete BEFORE DELETE ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;
CREATE TRIGGER quick_launch_authority_audit_no_update BEFORE UPDATE ON quick_launch_authority_audit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER quick_launch_authority_audit_no_delete BEFORE DELETE ON quick_launch_authority_audit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_schema10_bridge_only
BEFORE INSERT ON bilingual_authority_permit_v1
WHEN NOT EXISTS(
  SELECT 1 FROM bilingual_authority_bridge_marker_v1 m
  WHERE m.operation_id=NEW.operation_id AND m.action=NEW.action
    AND m.target_schema_sha256=NEW.target_schema_sha256
    AND m.authority_receipt_sha256=NEW.authority_receipt_sha256
    AND m.created_at=NEW.created_at AND m.consumed_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'BILINGUAL_AUTHORITY_SCHEMA10_BRIDGE_REQUIRED'); END;

CREATE TABLE source_registry_v1(
  source_id TEXT PRIMARY KEY CHECK(length(source_id) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK(revision>=1),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
  canonical_feed_url TEXT UNIQUE CHECK(canonical_feed_url IS NULL OR canonical_feed_url GLOB 'https://*'),
  canonical_url_valid INTEGER NOT NULL CHECK(canonical_url_valid IN(0,1)),
  site_url TEXT NOT NULL UNIQUE CHECK(site_url GLOB 'https://*'),
  source_kind TEXT NOT NULL CHECK(source_kind IN('rss','x_manual')),
  collection_mode TEXT NOT NULL CHECK(collection_mode IN('rss','manual_url')),
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
    OR (source_kind='x_manual' AND collection_mode='manual_url' AND canonical_feed_url IS NULL)),
  CHECK(source_kind<>'x_manual' OR (enabled=0 AND lifecycle_status='proposed' AND collection_onboarding_status='validating'))
) STRICT;
CREATE INDEX source_registry_list_idx ON source_registry_v1(lifecycle_status,enabled,updated_at DESC,source_id);

CREATE TABLE source_registry_rss_config_v1(
  config_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds BETWEEN 60 AND 86400),
  route_id TEXT NOT NULL CHECK(length(route_id) BETWEEN 1 AND 128),
  route_identity_sha256 TEXT NOT NULL CHECK(length(route_identity_sha256)=64 AND route_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_release_sha256 TEXT NOT NULL CHECK(length(route_release_sha256)=64 AND route_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_manifest_sha256 TEXT NOT NULL CHECK(length(route_manifest_sha256)=64 AND route_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  rights_status TEXT NOT NULL CHECK(rights_status IN('clear','blocked','unknown')),
  media_policy TEXT NOT NULL CHECK(media_policy IN('allowlisted','zero_media','blocked','unknown')),
  dedupe_strategy TEXT NOT NULL CHECK(dedupe_strategy='source_external_id_sha256_v1'),
  normalization_strategy TEXT NOT NULL CHECK(normalization_strategy='rss_xml_canonical_v1'),
  monitorability_policy TEXT NOT NULL CHECK(monitorability_policy='manifest_schedule_v1'),
  authorization_receipt_sha256 TEXT NOT NULL CHECK(length(authorization_receipt_sha256)=64 AND authorization_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_policy_sha256 TEXT NOT NULL CHECK(length(source_policy_sha256)=64 AND source_policy_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
) STRICT;

CREATE TABLE source_registry_health_v1(
  health_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN('never_run','healthy','degraded','stopped','manual_only','unknown')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_eligible_at TEXT,
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 120),
  external_calls INTEGER NOT NULL CHECK(external_calls>=0),
  observed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
  UNIQUE(source_id,observed_at)
) STRICT;
CREATE INDEX source_registry_health_source_idx ON source_registry_health_v1(source_id,observed_at DESC,health_id);

CREATE TABLE source_registry_history_v1(
  history_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id TEXT,
  action TEXT NOT NULL CHECK(action IN('migrated','proposed','validated','requeued','enabled','disabled','retired')),
  from_revision INTEGER CHECK(from_revision IS NULL OR from_revision>=1),
  to_revision INTEGER NOT NULL CHECK(to_revision>=1),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 120),
  row_sha256 TEXT NOT NULL CHECK(length(row_sha256)=64 AND row_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
) STRICT;
CREATE INDEX source_registry_history_source_idx ON source_registry_history_v1(source_id,to_revision DESC,history_id);

CREATE TABLE source_registry_outbox_v1(
  outbox_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  state TEXT NOT NULL CHECK(state IN('pending','leased','succeeded','failed','cancelled')),
  lease_token TEXT UNIQUE CHECK(lease_token IS NULL OR length(CAST(lease_token AS BLOB))=43),
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 3),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at),
  CHECK((state IN('leased','succeeded','failed'))=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
) STRICT;

CREATE TABLE source_registry_mutation_permit_v1(
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN('propose','validate','requeue','enable','disable','retire')),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  reason_code TEXT NOT NULL CHECK(reason_code IN('OPERATOR_REQUEST','VALIDATION_PASSED','VALIDATION_FAILED','POLICY_CHANGE','CREDENTIAL_ROTATION','INCIDENT','RETIREMENT')),
  authorization_ref TEXT,
  one_time_nonce TEXT NOT NULL UNIQUE CHECK(length(CAST(one_time_nonce AS BLOB))=43),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  consumed_at TEXT CHECK(consumed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',consumed_at)=consumed_at),
  UNIQUE(operation_id,source_id),
  UNIQUE(source_id,expected_revision),
  UNIQUE(request_hash)
) STRICT;

INSERT INTO source_registry_v1
SELECT s.source_id,1,m.display_name,s.feed_url,1,m.site_url,'rss','rss',s.enabled,
  CASE WHEN s.enabled=1 THEN 'active' ELSE 'paused' END,
  CASE WHEN s.enabled=1 THEN 'active' ELSE 'stopped' END,
  'valid','unique',
  'unknown','unknown',CASE WHEN s.enabled=1 THEN 'monitorable' ELSE 'unavailable' END,'ready','valid',m.authorization_expires_at,
  CASE WHEN s.enabled=1 THEN 'allowed' ELSE 'blocked' END,
  CASE WHEN s.enabled=1 THEN 'clear' ELSE 'platform' END,s.stop_epoch,s.stop_epoch,
  c.authorization_version,c.policy_epoch,c.recovery_epoch,m.identity_sha256,NULL,m.identity_sha256,
  (SELECT migrated_at FROM migration_0010_preflight),(SELECT migrated_at FROM migration_0010_preflight)
FROM source s JOIN migration_0010_rss_manifest m ON m.source_id=s.source_id CROSS JOIN internal_control c;

INSERT INTO source_registry_v1
SELECT x.source_id,1,x.handle,NULL,1,x.canonical_url,'x_manual','manual_url',0,'proposed','validating','pending','pending',
  'unknown','unknown','unknown','unchecked','unknown',NULL,'unknown','clear',1,1,c.authorization_version,c.policy_epoch,c.recovery_epoch,
  i.identity_sha256,NULL,i.identity_sha256,(SELECT migrated_at FROM migration_0010_preflight),(SELECT migrated_at FROM migration_0010_preflight)
FROM x_manual_source_registry x JOIN migration_0010_x_identity i ON i.source_id=x.source_id CROSS JOIN internal_control c;

INSERT INTO source_registry_rss_config_v1
SELECT 'rss-config-'||m.source_id,m.source_id,1,m.schedule_seconds,m.route_id,m.route_identity_sha256,m.route_release_sha256,
  m.route_manifest_sha256,m.rights_status,m.media_policy,'source_external_id_sha256_v1','rss_xml_canonical_v1',
  'manifest_schedule_v1',m.authorization_receipt_sha256,m.source_policy_sha256,(SELECT migrated_at FROM migration_0010_preflight)
FROM migration_0010_rss_manifest m;

INSERT INTO source_registry_health_v1
SELECT 'health-migrated-'||s.source_id,s.source_id,
  CASE WHEN s.enabled=0 THEN 'stopped' WHEN s.last_success_at IS NOT NULL THEN 'healthy' WHEN s.last_attempt_at IS NOT NULL THEN 'degraded' ELSE 'never_run' END,
  s.last_attempt_at,s.last_success_at,s.next_eligible_at,s.last_reason_code,0,(SELECT migrated_at FROM migration_0010_preflight)
FROM source s;
INSERT INTO source_registry_health_v1
SELECT 'health-migrated-'||x.source_id,x.source_id,'manual_only',NULL,NULL,NULL,'X_MANUAL_URL_ONLY',0,
  (SELECT migrated_at FROM migration_0010_preflight) FROM x_manual_source_registry x;

INSERT INTO source_registry_history_v1
SELECT 'history-migrated-'||r.source_id,r.source_id,NULL,'migrated',NULL,1,NULL,
  r.lifecycle_status||'/'||r.collection_onboarding_status,'SCHEMA9_DETERMINISTIC_BACKFILL',r.identity_sha256,
  (SELECT migrated_at FROM migration_0010_preflight) FROM source_registry_v1 r;

CREATE TRIGGER source_registry_mutation_permit_insert_guard BEFORE INSERT ON source_registry_mutation_permit_v1
WHEN NOT EXISTS(
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
      OR (NEW.action='retire' AND op.operation_kind='source_delete' AND op.policy_id='p-source-delete-paused' AND op.phase='paused'))
)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_INVALID'); END;
CREATE TRIGGER source_registry_mutation_permit_update_guard BEFORE UPDATE ON source_registry_mutation_permit_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.source_id<>OLD.source_id OR NEW.action<>OLD.action OR NEW.expected_revision<>OLD.expected_revision
  OR NEW.request_hash<>OLD.request_hash OR NEW.reason_code<>OLD.reason_code OR NEW.authorization_ref IS NOT OLD.authorization_ref
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.created_at<>OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_IMMUTABLE'); END;
CREATE TRIGGER source_registry_mutation_permit_no_delete BEFORE DELETE ON source_registry_mutation_permit_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_IMMUTABLE'); END;

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

CREATE TRIGGER source_registry_health_x_zero_guard BEFORE INSERT ON source_registry_health_v1
WHEN NEW.external_calls<>0 AND EXISTS(SELECT 1 FROM source_registry_v1 s WHERE s.source_id=NEW.source_id AND s.source_kind='x_manual')
BEGIN SELECT RAISE(ABORT,'X_AUTOMATION_DISABLED'); END;
CREATE TRIGGER source_registry_no_delete BEFORE DELETE ON source_registry_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RETIRE_IS_STATE_TRANSITION'); END;

CREATE TRIGGER source_registry_rss_config_no_update BEFORE UPDATE ON source_registry_rss_config_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER source_registry_rss_config_no_delete BEFORE DELETE ON source_registry_rss_config_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_CONFIG_IMMUTABLE'); END;
CREATE TRIGGER source_registry_health_no_update BEFORE UPDATE ON source_registry_health_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HEALTH_APPEND_ONLY'); END;
CREATE TRIGGER source_registry_health_no_delete BEFORE DELETE ON source_registry_health_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HEALTH_APPEND_ONLY'); END;
CREATE TRIGGER source_registry_history_no_update BEFORE UPDATE ON source_registry_history_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER source_registry_history_no_delete BEFORE DELETE ON source_registry_history_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HISTORY_APPEND_ONLY'); END;
CREATE TRIGGER source_registry_outbox_transition_guard BEFORE UPDATE ON source_registry_outbox_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_AUTHORITY_EXTENSION_REQUIRED'); END;
CREATE TRIGGER source_registry_outbox_insert_guard BEFORE INSERT ON source_registry_outbox_v1
WHEN NOT EXISTS(SELECT 1 FROM source_registry_v1 s JOIN source_registry_mutation_permit_v1 p ON p.operation_id=NEW.operation_id
  WHERE s.source_id=NEW.source_id AND s.current_operation_id=NEW.operation_id AND s.revision=NEW.source_revision
    AND s.enabled=1 AND p.source_id=s.source_id AND p.action='enable' AND p.consumed_at=NEW.created_at
    AND NEW.state='pending' AND NEW.attempt_count=0 AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
    AND NEW.payload_sha256=s.current_request_hash AND NEW.updated_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_INSERT_INVALID'); END;
CREATE TRIGGER source_registry_outbox_no_delete BEFORE DELETE ON source_registry_outbox_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_APPEND_ONLY'); END;

DROP TABLE migration_0010_assert;
PRAGMA user_version=10;
COMMIT;
