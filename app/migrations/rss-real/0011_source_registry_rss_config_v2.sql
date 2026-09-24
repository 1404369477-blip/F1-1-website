-- F1+1 additive migration 0011: source_registry_rss_config_v2 for Motorsport / The Race.
--
-- Does not rewrite 0010 or mutate source_registry_rss_config_v1.
-- Autosport / RaceFans stay on immutable v1 placeholder rows.
-- user_version remains 10. Schema fingerprint changes; Admin must pin the new hash before production apply.
-- MIGRATION_CANONICAL_SHA256=d7af89d7235a8b67696c3895030c7ac97899bcfc9baa48ad8b253a00ef28bed3

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0011_assert(value INTEGER NOT NULL CHECK(value=1)) STRICT;
INSERT INTO migration_0011_assert
SELECT CASE WHEN
  (SELECT count(*) FROM migration_0011_preflight)=1
  AND (SELECT source_user_version FROM migration_0011_preflight)=10
  AND (SELECT apply_enabled FROM migration_0011_preflight)=1
  AND (SELECT count(*) FROM sqlite_schema WHERE name IN (
    'source_registry_rss_config_v2','source_registry_rss_config_v2_identity','source_registry_rss_config_current'
  ))=0
  AND (SELECT count(*) FROM migration_0011_source)=2
  AND (SELECT count(*) FROM migration_0011_source WHERE source_id IN ('motorsport-f1-news','the-race-f1-news'))=2
  AND NOT EXISTS(SELECT 1 FROM migration_0011_source WHERE source_id NOT IN ('motorsport-f1-news','the-race-f1-news'))
  AND (SELECT count(*) FROM source_registry_rss_config_v1 WHERE source_id IN ('motorsport-f1-news','the-race-f1-news'))=2
  AND NOT EXISTS(
    SELECT 1 FROM migration_0011_source m
    LEFT JOIN source_registry_rss_config_v1 v1 ON v1.source_id=m.source_id AND v1.config_id=m.v1_config_id
    WHERE v1.source_id IS NULL
  )
  AND (SELECT count(*) FROM route_registry WHERE route_id IN ('rss-route-motorsport','rss-route-the-race'))=0
  AND NOT EXISTS(SELECT 1 FROM migration_0011_source WHERE route_identity_sha256 IN (
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
  AND (SELECT count(*) FROM internal_control)=1
  THEN 1 ELSE 0 END;

CREATE TABLE source_registry_rss_config_v2(
  config_id TEXT PRIMARY KEY CHECK(config_id GLOB 'rss-cfg-v2-*'),
  source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK(source_id IN ('motorsport-f1-news','the-race-f1-news')),
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  v1_config_id TEXT NOT NULL REFERENCES source_registry_rss_config_v1(config_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds=900),
  route_id TEXT NOT NULL CHECK(route_id IN ('rss-route-motorsport','rss-route-the-race')),
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
  CHECK((source_id='motorsport-f1-news' AND route_id='rss-route-motorsport' AND v1_config_id='rss-config-motorsport-f1-news')
    OR (source_id='the-race-f1-news' AND route_id='rss-route-the-race' AND v1_config_id='rss-config-the-race-f1-news')),
  CHECK(unixepoch(authorization_expires_at)>unixepoch(created_at))
) STRICT;
CREATE UNIQUE INDEX source_registry_rss_config_v2_current_idx
  ON source_registry_rss_config_v2(source_id) WHERE superseded_at IS NULL;

CREATE TABLE source_registry_rss_config_v2_identity(
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
  migration_0011_canonical_sha256 TEXT NOT NULL CHECK(length(migration_0011_canonical_sha256)=64 AND migration_0011_canonical_sha256 NOT GLOB '*[^0-9a-f]*'),
  motorsport_route_identity_sha256 TEXT NOT NULL CHECK(length(motorsport_route_identity_sha256)=64 AND motorsport_route_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  the_race_route_identity_sha256 TEXT NOT NULL CHECK(length(the_race_route_identity_sha256)=64 AND the_race_route_identity_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_release_sha256 TEXT NOT NULL CHECK(length(route_release_sha256)=64 AND route_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  route_manifest_sha256 TEXT NOT NULL CHECK(length(route_manifest_sha256)=64 AND route_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  applied_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',applied_at)=applied_at)
) STRICT;

INSERT INTO route_registry
SELECT m.route_id,'rss','rss_https','rss_fetch',m.route_identity_sha256,p.route_release_sha256,p.route_manifest_sha256,'active',1
FROM migration_0011_source m CROSS JOIN migration_0011_preflight p;

INSERT INTO source_registry_rss_config_v2
SELECT 'rss-cfg-v2-'||m.source_id||'-1',m.source_id,1,m.v1_config_id,900,m.route_id,m.route_identity_sha256,
  p.route_release_sha256,p.route_manifest_sha256,'clear','allowlisted','source_external_id_sha256_v1','rss_xml_canonical_v1',
  'manifest_schedule_v1',m.authorization_receipt_sha256,p.authorization_expires_at,m.source_policy_sha256,NULL,p.applied_at,NULL
FROM migration_0011_source m CROSS JOIN migration_0011_preflight p;

INSERT INTO source_registry_rss_config_v2_identity
SELECT 1,p.migration_0011_canonical_sha256,
  (SELECT route_identity_sha256 FROM migration_0011_source WHERE source_id='motorsport-f1-news'),
  (SELECT route_identity_sha256 FROM migration_0011_source WHERE source_id='the-race-f1-news'),
  p.route_release_sha256,p.route_manifest_sha256,p.applied_at
FROM migration_0011_preflight p;

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
LEFT JOIN source_registry_rss_config_v2 v2 ON v2.source_id=v1.source_id AND v2.superseded_at IS NULL;

CREATE TRIGGER source_registry_rss_config_v2_no_delete BEFORE DELETE ON source_registry_rss_config_v2
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_rss_config_v2_update_guard BEFORE UPDATE ON source_registry_rss_config_v2
WHEN NEW.config_id<>OLD.config_id OR NEW.source_id<>OLD.source_id OR NEW.source_revision<>OLD.source_revision
  OR NEW.v1_config_id<>OLD.v1_config_id OR NEW.schedule_seconds<>OLD.schedule_seconds OR NEW.route_id<>OLD.route_id
  OR NEW.route_identity_sha256<>OLD.route_identity_sha256 OR NEW.route_release_sha256<>OLD.route_release_sha256
  OR NEW.route_manifest_sha256<>OLD.route_manifest_sha256 OR NEW.rights_status<>OLD.rights_status
  OR NEW.media_policy<>OLD.media_policy OR NEW.dedupe_strategy<>OLD.dedupe_strategy
  OR NEW.normalization_strategy<>OLD.normalization_strategy OR NEW.monitorability_policy<>OLD.monitorability_policy
  OR NEW.authorization_receipt_sha256<>OLD.authorization_receipt_sha256
  OR NEW.authorization_expires_at<>OLD.authorization_expires_at OR NEW.source_policy_sha256<>OLD.source_policy_sha256
  OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at<>OLD.created_at
  OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_v2_insert_guard BEFORE INSERT ON source_registry_rss_config_v2
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_INSERT_CLOSED'); END;

CREATE TRIGGER source_registry_rss_config_v2_identity_no_update BEFORE UPDATE ON source_registry_rss_config_v2_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER source_registry_rss_config_v2_identity_no_delete BEFORE DELETE ON source_registry_rss_config_v2_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_IDENTITY_IMMUTABLE'); END;

DROP TABLE migration_0011_assert;
PRAGMA user_version=10;
COMMIT;
