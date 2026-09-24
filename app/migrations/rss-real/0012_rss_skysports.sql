-- F1+1 additive migration 0012: Sky Sports official F1 RSS (skysports-f1-news).
--
-- Rebuilds the closed 4-source CHECK on `source` (0006-class).
-- Does not rewrite 0010/0011 SQL, v1 placeholder rows, or v2 Motorsport/The Race rows.
-- Autosport / RaceFans stay isolated by collector allowlist, not by this migration.
-- user_version remains 10. Schema fingerprint changes; Admin must pin the new hash before production apply.
-- MIGRATION_CANONICAL_SHA256=c9efdbfb0725994fc0617984c5b89dab937da69b37172eff249ef9248d94d278

PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0012_assert(value INTEGER NOT NULL CHECK(value=1)) STRICT;
INSERT INTO migration_0012_assert
SELECT CASE WHEN
  (SELECT count(*) FROM migration_0012_preflight)=1
  AND (SELECT source_user_version FROM migration_0012_preflight)=10
  AND (SELECT apply_enabled FROM migration_0012_preflight)=1
  AND (SELECT count(*) FROM sqlite_schema WHERE name IN (
    'source_registry_rss_config_v3','source_registry_rss_skysports_identity'
  ))=0
  AND (SELECT count(*) FROM sqlite_schema WHERE name='source_registry_rss_config_v2')=1
  AND (SELECT count(*) FROM migration_0012_source)=1
  AND (SELECT count(*) FROM migration_0012_source WHERE source_id='skysports-f1-news' AND route_id='rss-route-skysports')=1
  AND NOT EXISTS(SELECT 1 FROM source WHERE source_id='skysports-f1-news')
  AND NOT EXISTS(SELECT 1 FROM source_registry_v1 WHERE source_id='skysports-f1-news')
  AND NOT EXISTS(SELECT 1 FROM route_registry WHERE route_id='rss-route-skysports')
  AND NOT EXISTS(SELECT 1 FROM source_registry_rss_config_v2 WHERE source_id IN ('autosport-f1-news','racefans-f1-news','skysports-f1-news'))
  AND (SELECT count(*) FROM source)=4
  AND (SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name='gateway_source_insert_guard')=1
  AND (SELECT count(*) FROM source_registry_rss_config_v1)=4
  AND (SELECT count(*) FROM source_registry_rss_config_v2)=2
  AND (SELECT count(*) FROM internal_control)=1
  AND NOT EXISTS(SELECT 1 FROM source_registry_v1 r JOIN migration_0012_source m
    ON r.identity_sha256=m.identity_sha256 OR r.site_url=m.site_url OR r.canonical_feed_url=m.feed_url)
  AND NOT EXISTS(SELECT 1 FROM migration_0012_source WHERE route_identity_sha256 IN (
    '1111111111111111111111111111111111111111111111111111111111111111',
    '4444444444444444444444444444444444444444444444444444444444444444',
    '5555555555555555555555555555555555555555555555555555555555555555'
  ) OR authorization_receipt_sha256 IN (
    '1111111111111111111111111111111111111111111111111111111111111111',
    '4444444444444444444444444444444444444444444444444444444444444444',
    '5555555555555555555555555555555555555555555555555555555555555555'
  ) OR source_policy_sha256 IN (
    '1111111111111111111111111111111111111111111111111111111111111111',
    '4444444444444444444444444444444444444444444444444444444444444444',
    '5555555555555555555555555555555555555555555555555555555555555555'
  ))
  THEN 1 ELSE 0 END;

CREATE TABLE source_v12 (
  source_id TEXT PRIMARY KEY CHECK (source_id IN (
    'motorsport-f1-news',
    'autosport-f1-news',
    'racefans-f1-news',
    'the-race-f1-news',
    'skysports-f1-news'
  )),
  feed_url TEXT NOT NULL UNIQUE CHECK (feed_url IN (
    'https://www.motorsport.com/rss/f1/news/',
    'https://www.autosport.com/rss/f1/news/',
    'https://www.racefans.net/category/formula-1/feed/',
    'https://www.the-race.com/category/formula-1/rss/',
    'https://www.skysports.com/rss/12433'
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
    (source_id = 'the-race-f1-news' AND feed_url = 'https://www.the-race.com/category/formula-1/rss/') OR
    (source_id = 'skysports-f1-news' AND feed_url = 'https://www.skysports.com/rss/12433')
  )
) STRICT;

INSERT INTO source_v12 (
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
)
SELECT
  source_id, feed_url, enabled, stop_epoch, etag, last_modified,
  last_attempt_at, last_success_at, next_eligible_at, last_reason_code
FROM source;

DROP TRIGGER gateway_source_insert_guard;
DROP TRIGGER gateway_source_update_guard;
DROP TRIGGER gateway_source_delete_guard;
ALTER TABLE source RENAME TO source_pre_0012;
ALTER TABLE source_v12 RENAME TO source;

INSERT INTO source (
  source_id,
  feed_url,
  enabled,
  stop_epoch,
  last_reason_code
) VALUES (
  'skysports-f1-news',
  'https://www.skysports.com/rss/12433',
  1,
  1,
  'NEVER_RUN'
);

CREATE TRIGGER gateway_source_insert_guard BEFORE INSERT ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=NEW.source_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_update_guard BEFORE UPDATE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;
CREATE TRIGGER gateway_source_delete_guard BEFORE DELETE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='delete' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

DROP TABLE source_pre_0012;

DROP TRIGGER source_registry_insert_guard;

INSERT INTO source_registry_v1
SELECT m.source_id,1,m.display_name,m.feed_url,1,m.site_url,'rss','rss',1,'active','active','valid','unique',
  'unknown','unknown','monitorable','ready','valid',p.authorization_expires_at,'allowed','clear',
  s.stop_epoch,s.stop_epoch,c.authorization_version,c.policy_epoch,c.recovery_epoch,m.identity_sha256,NULL,m.identity_sha256,
  p.applied_at,p.applied_at
FROM migration_0012_source m
CROSS JOIN migration_0012_preflight p
CROSS JOIN internal_control c
JOIN source s ON s.source_id=m.source_id;

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

INSERT INTO source_registry_health_v1
SELECT 'health-migrated-'||m.source_id,m.source_id,'never_run',NULL,NULL,NULL,'NEVER_RUN',0,p.applied_at
FROM migration_0012_source m CROSS JOIN migration_0012_preflight p;

INSERT INTO source_registry_history_v1
SELECT 'history-migrated-'||m.source_id,m.source_id,NULL,'migrated',NULL,1,NULL,
  'active/active','SCHEMA10_SKYSPORTS_RSS_0012',m.identity_sha256,p.applied_at
FROM migration_0012_source m CROSS JOIN migration_0012_preflight p;

INSERT INTO route_registry
SELECT m.route_id,'rss','rss_https','rss_fetch',m.route_identity_sha256,p.route_release_sha256,p.route_manifest_sha256,'active',1
FROM migration_0012_source m CROSS JOIN migration_0012_preflight p;

CREATE TABLE source_registry_rss_config_v3(
  config_id TEXT PRIMARY KEY CHECK(config_id GLOB 'rss-cfg-v3-*'),
  source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK(source_id='skysports-f1-news'),
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds=900),
  route_id TEXT NOT NULL CHECK(route_id='rss-route-skysports'),
  route_identity_sha256 TEXT NOT NULL CHECK(length(route_identity_sha256)=64 AND route_identity_sha256 NOT GLOB '*[^0-9a-f]*'
    AND route_identity_sha256<>'1111111111111111111111111111111111111111111111111111111111111111'
    AND route_identity_sha256<>'4444444444444444444444444444444444444444444444444444444444444444'
    AND route_identity_sha256<>'5555555555555555555555555555555555555555555555555555555555555555'),
  route_release_sha256 TEXT NOT NULL CHECK(length(route_release_sha256)=64 AND route_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_manifest_sha256 TEXT NOT NULL CHECK(length(route_manifest_sha256)=64 AND route_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  rights_status TEXT NOT NULL CHECK(rights_status IN('clear','blocked','unknown')),
  media_policy TEXT NOT NULL CHECK(media_policy IN('allowlisted','zero_media','blocked','unknown')),
  dedupe_strategy TEXT NOT NULL CHECK(dedupe_strategy='source_external_id_sha256_v1'),
  normalization_strategy TEXT NOT NULL CHECK(normalization_strategy='rss_xml_canonical_v1'),
  monitorability_policy TEXT NOT NULL CHECK(monitorability_policy='manifest_schedule_v1'),
  authorization_receipt_sha256 TEXT NOT NULL CHECK(length(authorization_receipt_sha256)=64 AND authorization_receipt_sha256 NOT GLOB '*[^0-9a-f]*'
    AND authorization_receipt_sha256<>'1111111111111111111111111111111111111111111111111111111111111111'
    AND authorization_receipt_sha256<>'4444444444444444444444444444444444444444444444444444444444444444'
    AND authorization_receipt_sha256<>'5555555555555555555555555555555555555555555555555555555555555555'),
  authorization_expires_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',authorization_expires_at)=authorization_expires_at),
  source_policy_sha256 TEXT NOT NULL CHECK(length(source_policy_sha256)=64 AND source_policy_sha256 NOT GLOB '*[^0-9a-f]*'
    AND source_policy_sha256<>'1111111111111111111111111111111111111111111111111111111111111111'
    AND source_policy_sha256<>'4444444444444444444444444444444444444444444444444444444444444444'
    AND source_policy_sha256<>'5555555555555555555555555555555555555555555555555555555555555555'),
  operation_id TEXT REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  superseded_at TEXT CHECK(superseded_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',superseded_at)=superseded_at),
  UNIQUE(source_id, source_revision),
  CHECK(unixepoch(authorization_expires_at)>unixepoch(created_at))
) STRICT;
CREATE UNIQUE INDEX source_registry_rss_config_v3_current_idx
  ON source_registry_rss_config_v3(source_id) WHERE superseded_at IS NULL;

INSERT INTO source_registry_rss_config_v3
SELECT 'rss-cfg-v3-'||m.source_id||'-1',m.source_id,1,900,m.route_id,m.route_identity_sha256,
  p.route_release_sha256,p.route_manifest_sha256,'clear','allowlisted','source_external_id_sha256_v1','rss_xml_canonical_v1',
  'manifest_schedule_v1',m.authorization_receipt_sha256,p.authorization_expires_at,m.source_policy_sha256,NULL,p.applied_at,NULL
FROM migration_0012_source m CROSS JOIN migration_0012_preflight p;

CREATE TABLE source_registry_rss_skysports_identity(
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
  migration_0012_canonical_sha256 TEXT NOT NULL CHECK(length(migration_0012_canonical_sha256)=64 AND migration_0012_canonical_sha256 NOT GLOB '*[^0-9a-f]*'),
  sky_route_identity_sha256 TEXT NOT NULL CHECK(length(sky_route_identity_sha256)=64 AND sky_route_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_release_sha256 TEXT NOT NULL CHECK(length(route_release_sha256)=64 AND route_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_manifest_sha256 TEXT NOT NULL CHECK(length(route_manifest_sha256)=64 AND route_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  applied_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',applied_at)=applied_at)
) STRICT;

INSERT INTO source_registry_rss_skysports_identity
SELECT 1,p.migration_0012_canonical_sha256,m.route_identity_sha256,p.route_release_sha256,p.route_manifest_sha256,p.applied_at
FROM migration_0012_preflight p CROSS JOIN migration_0012_source m;

DROP VIEW source_registry_rss_config_current;
CREATE VIEW source_registry_rss_config_current AS
SELECT
  CASE WHEN v2.source_id IS NOT NULL THEN v2.config_id ELSE v1.config_id END AS config_id,
  v1.source_id AS source_id,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.source_revision ELSE v1.source_revision END AS source_revision,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.schedule_seconds ELSE v1.schedule_seconds END AS schedule_seconds,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.route_id ELSE v1.route_id END AS route_id,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.route_identity_sha256 ELSE v1.route_identity_sha256 END AS route_identity_sha256,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.route_release_sha256 ELSE v1.route_release_sha256 END AS route_release_sha256,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.route_manifest_sha256 ELSE v1.route_manifest_sha256 END AS route_manifest_sha256,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.rights_status ELSE v1.rights_status END AS rights_status,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.media_policy ELSE v1.media_policy END AS media_policy,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.dedupe_strategy ELSE v1.dedupe_strategy END AS dedupe_strategy,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.normalization_strategy ELSE v1.normalization_strategy END AS normalization_strategy,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.monitorability_policy ELSE v1.monitorability_policy END AS monitorability_policy,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.authorization_receipt_sha256 ELSE v1.authorization_receipt_sha256 END AS authorization_receipt_sha256,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.source_policy_sha256 ELSE v1.source_policy_sha256 END AS source_policy_sha256,
  CASE WHEN v2.source_id IS NOT NULL THEN v2.created_at ELSE v1.created_at END AS created_at,
  CASE WHEN v2.source_id IS NOT NULL THEN 'v2' ELSE 'v1' END AS config_layer
FROM source_registry_rss_config_v1 v1
LEFT JOIN source_registry_rss_config_v2 v2 ON v2.source_id=v1.source_id AND v2.superseded_at IS NULL
UNION ALL
SELECT
  v3.config_id, v3.source_id, v3.source_revision, v3.schedule_seconds, v3.route_id,
  v3.route_identity_sha256, v3.route_release_sha256, v3.route_manifest_sha256,
  v3.rights_status, v3.media_policy, v3.dedupe_strategy, v3.normalization_strategy, v3.monitorability_policy,
  v3.authorization_receipt_sha256, v3.source_policy_sha256, v3.created_at, 'v3'
FROM source_registry_rss_config_v3 v3
WHERE v3.superseded_at IS NULL;

CREATE TRIGGER source_registry_rss_config_v3_no_delete BEFORE DELETE ON source_registry_rss_config_v3
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V3_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_rss_config_v3_update_guard BEFORE UPDATE ON source_registry_rss_config_v3
WHEN NEW.config_id<>OLD.config_id OR NEW.source_id<>OLD.source_id OR NEW.source_revision<>OLD.source_revision
  OR NEW.schedule_seconds<>OLD.schedule_seconds OR NEW.route_id<>OLD.route_id
  OR NEW.route_identity_sha256<>OLD.route_identity_sha256 OR NEW.route_release_sha256<>OLD.route_release_sha256
  OR NEW.route_manifest_sha256<>OLD.route_manifest_sha256 OR NEW.rights_status<>OLD.rights_status
  OR NEW.media_policy<>OLD.media_policy OR NEW.dedupe_strategy<>OLD.dedupe_strategy
  OR NEW.normalization_strategy<>OLD.normalization_strategy OR NEW.monitorability_policy<>OLD.monitorability_policy
  OR NEW.authorization_receipt_sha256<>OLD.authorization_receipt_sha256
  OR NEW.authorization_expires_at<>OLD.authorization_expires_at OR NEW.source_policy_sha256<>OLD.source_policy_sha256
  OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at<>OLD.created_at
  OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V3_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_v3_insert_guard BEFORE INSERT ON source_registry_rss_config_v3
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V3_INSERT_CLOSED'); END;

CREATE TRIGGER source_registry_rss_skysports_identity_no_update BEFORE UPDATE ON source_registry_rss_skysports_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_SKYSPORTS_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER source_registry_rss_skysports_identity_no_delete BEFORE DELETE ON source_registry_rss_skysports_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_SKYSPORTS_IDENTITY_IMMUTABLE'); END;

DROP TABLE migration_0012_assert;
PRAGMA user_version=10;
COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
