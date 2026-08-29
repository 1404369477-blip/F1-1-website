-- F1+1 additive migration 0008: X manual URL inbox.
-- This migration is intentionally disabled-by-default: it stores human
-- submissions and registry metadata only. It has no collector, resolver,
-- cookie, RSSHub, polling, search, review, or publication capability.
-- MIGRATION_CANONICAL_SHA256=f78b9f98227fcfb18de9bf7b09fef86cd62fd7c9282edb0bfb9fd1528fd2913a

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_0008_assert (
  value INTEGER NOT NULL CHECK (value = 1)
) STRICT;

INSERT INTO migration_0008_assert (value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1
    FROM sqlite_temp_master
    WHERE type = 'table' AND name = 'migration_0008_preflight'
  )
  AND (SELECT source_user_version FROM migration_0008_preflight) = 7
  AND (SELECT source_schema_sha256 FROM migration_0008_preflight) = 'f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60'
  AND (SELECT migration_canonical_sha256 FROM migration_0008_preflight) = 'd651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797'
  AND (SELECT apply_enabled FROM migration_0008_preflight) = 1
  AND (SELECT length(source_schema_sha256) FROM migration_0008_preflight) = 64
  THEN 1 ELSE 0 END;

CREATE TABLE x_manual_source_registry (
  source_id TEXT PRIMARY KEY
    CHECK (source_id = lower(source_id) AND source_id GLOB 'x_[a-z0-9_]*'),
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  handle TEXT NOT NULL CHECK (length(handle) BETWEEN 1 AND 15),
  canonical_url TEXT NOT NULL UNIQUE
    CHECK (canonical_url GLOB 'https://x.com/*'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled = 0),
  lifecycle_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (lifecycle_status = 'proposed'),
  collection_onboarding_status TEXT NOT NULL DEFAULT 'validating'
    CHECK (collection_onboarding_status = 'validating'),
  normalization_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (normalization_status = 'pending'),
  dedup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (dedup_status = 'pending'),
  identity_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (identity_status = 'unknown'),
  relevance_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (relevance_status = 'unknown'),
  monitorability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (monitorability = 'unknown'),
  adapter_status TEXT NOT NULL DEFAULT 'unchecked'
    CHECK (adapter_status = 'unchecked'),
  adapter_authorization_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (adapter_authorization_status = 'unknown'),
  platform_allowed TEXT NOT NULL DEFAULT 'unknown'
    CHECK (platform_allowed = 'unknown'),
  source_stop_status TEXT NOT NULL DEFAULT 'clear'
    CHECK (source_stop_status = 'clear'),
  source_config_epoch INTEGER NOT NULL DEFAULT 1 CHECK (source_config_epoch = 1),
  source_safety_epoch INTEGER NOT NULL DEFAULT 1 CHECK (source_safety_epoch = 1),
  source_kind TEXT NOT NULL DEFAULT 'x_manual' CHECK (source_kind = 'x_manual'),
  collection_mode TEXT NOT NULL DEFAULT 'manual_url'
    CHECK (collection_mode = 'manual_url'),
  inventory_sha256 TEXT NOT NULL
    CHECK (length(inventory_sha256) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (lower(handle) = lower(substr(canonical_url, length('https://x.com/') + 1)))
) STRICT;

CREATE INDEX x_manual_source_registry_enabled_idx
  ON x_manual_source_registry (enabled, lifecycle_status, source_id);

INSERT INTO x_manual_source_registry (
  source_id, handle, canonical_url, inventory_sha256, created_at, updated_at
) VALUES
  ('x_formula24hrs', 'Formula24hrs', 'https://x.com/formula24hrs', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_fanaticsferrari', 'FanaticsFerrari', 'https://x.com/fanaticsferrari', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_f1hardwalls4k', 'F1HardWalls4K', 'https://x.com/f1hardwalls4k', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_massafelipe19', 'MassaFelipe19', 'https://x.com/massafelipe19', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_wbuxtonofficial', 'wbuxtonofficial', 'https://x.com/wbuxtonofficial', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_kevinmagnussen', 'KevinMagnussen', 'https://x.com/kevinmagnussen', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_chrismedlandf1', 'ChrisMedlandF1', 'https://x.com/chrismedlandf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_svandoorne', 'svandoorne', 'https://x.com/svandoorne', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_tgruener', 'tgruener', 'https://x.com/tgruener', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_ferrariraces', 'FerrariRaces', 'https://x.com/ferrariraces', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_oconesteban', 'OconEsteban', 'https://x.com/oconesteban', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_mattp1gallagher', 'MattP1Gallagher', 'https://x.com/mattp1gallagher', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_hyonibeee', 'hyonibeee', 'https://x.com/hyonibeee', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_aussiegrit', 'AussieGrit', 'https://x.com/aussiegrit', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_espnf1', 'ESPNF1', 'https://x.com/espnf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_croftyf1', 'CroftyF1', 'https://x.com/croftyf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_afcorse', 'AFCorse', 'https://x.com/afcorse', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_f1mikahakkinen', 'F1MikaHakkinen', 'https://x.com/f1mikahakkinen', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_richardhammond', 'RichardHammond', 'https://x.com/richardhammond', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_mrjamesmay', 'MrJamesMay', 'https://x.com/mrjamesmay', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_zhouguanyu24', 'ZhouGuanyu24', 'https://x.com/zhouguanyu24', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_zbrownceo', 'ZBrownCEO', 'https://x.com/zbrownceo', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_nicorosberg', 'NicoRosberg', 'https://x.com/nicorosberg', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_ferrari', 'Ferrari', 'https://x.com/ferrari', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_jeremyclarkson', 'JeremyClarkson', 'https://x.com/jeremyclarkson', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_lewishamilton', 'LewisHamilton', 'https://x.com/lewishamilton', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_jensonbutton', 'JensonButton', 'https://x.com/jensonbutton', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_jeantodt', 'JeanTodt', 'https://x.com/jeantodt', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_lance_stroll', 'lance_stroll', 'https://x.com/lance_stroll', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_anto_giovinazzi', 'Anto_Giovinazzi', 'https://x.com/anto_giovinazzi', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_danielricciardo', 'danielricciardo', 'https://x.com/danielricciardo', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_yukitsunoda07', 'yukitsunoda07', 'https://x.com/yukitsunoda07', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_alex_albon', 'alex_albon', 'https://x.com/alex_albon', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_alo_oficial', 'alo_oficial', 'https://x.com/alo_oficial', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_schecoperez', 'SChecoPerez', 'https://x.com/schecoperez', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_pierregasly', 'PierreGASLY', 'https://x.com/pierregasly', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_carlossainz55', 'Carlossainz55', 'https://x.com/carlossainz55', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_schumachermick', 'SchumacherMick', 'https://x.com/schumachermick', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_haasf1team', 'HaasF1Team', 'https://x.com/haasf1team', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_visacashapprb', 'visacashapprb', 'https://x.com/visacashapprb', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_georgerussell63', 'GeorgeRussell63', 'https://x.com/georgerussell63', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_hulkhulkenberg', 'HulkHulkenberg', 'https://x.com/hulkhulkenberg', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_landonorris', 'LandoNorris', 'https://x.com/landonorris', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_charles_leclerc', 'Charles_Leclerc', 'https://x.com/charles_leclerc', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_audif1_', 'audif1_', 'https://x.com/audif1_', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_astonmartinf1', 'AstonMartinF1', 'https://x.com/astonmartinf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_valtteribottas', 'ValtteriBottas', 'https://x.com/valtteribottas', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_fia', 'fia', 'https://x.com/fia', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_max33verstappen', 'Max33Verstappen', 'https://x.com/max33verstappen', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_f1', 'F1', 'https://x.com/f1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_redbullracing', 'redbullracing', 'https://x.com/redbullracing', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_williamsf1', 'WilliamsF1', 'https://x.com/williamsf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_alpinef1team', 'AlpineF1Team', 'https://x.com/alpinef1team', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_scuderiaferrari', 'ScuderiaFerrari', 'https://x.com/scuderiaferrari', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_mclarenf1', 'McLarenF1', 'https://x.com/mclarenf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_mercedesamgf1', 'MercedesAMGF1', 'https://x.com/mercedesamgf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_skysportsf1', 'SkySportsF1', 'https://x.com/skysportsf1', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_motorsport', 'Motorsport', 'https://x.com/motorsport', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
  ('x_autosport', 'autosport', 'https://x.com/autosport', 'bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');

CREATE TRIGGER x_manual_source_registry_immutable_update
BEFORE UPDATE ON x_manual_source_registry
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SOURCE_REGISTRY_IMMUTABLE');
END;

CREATE TRIGGER x_manual_source_registry_immutable_delete
BEFORE DELETE ON x_manual_source_registry
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SOURCE_REGISTRY_IMMUTABLE');
END;

-- Schema 7 intentionally freezes its operation-kind and entity-kind enums.
-- This additive mapping gives X a semantic identity while the authoritative
-- state/capability/handoff/policy/audit chain remains internal_operation.
-- The mapped schema-7 operation is a no-egress admin control capability; the
-- runtime authorizer maps it to the narrow x_manual SQL method and never to
-- phase_control or legacy_source.
CREATE TABLE x_manual_operation (
  operation_id TEXT PRIMARY KEY
    REFERENCES internal_operation (operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  semantic_kind TEXT NOT NULL CHECK (semantic_kind IN ('x_submit', 'x_retire')),
  submission_id TEXT NOT NULL CHECK (submission_id GLOB 'xsub_[a-z0-9]*'),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  CHECK (semantic_kind <> 'x_submit' OR expected_revision = 0),
  UNIQUE (operation_id, semantic_kind, submission_id, expected_revision)
) STRICT;

CREATE TABLE x_manual_submission (
  submission_id TEXT PRIMARY KEY
    CHECK (submission_id GLOB 'xsub_[a-z0-9]*'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  submitted_url TEXT NOT NULL CHECK (length(submitted_url) BETWEEN 1 AND 2048),
  canonical_url TEXT NOT NULL UNIQUE
    CHECK (canonical_url GLOB 'https://x.com/*/status/[0-9]*'),
  status_id TEXT NOT NULL UNIQUE
    CHECK (status_id GLOB '[0-9]*' AND length(status_id) BETWEEN 1 AND 19),
  dedupe_key TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) = 64),
  state TEXT NOT NULL
    CHECK (state IN ('submitted', 'validated', 'candidate_created', 'retired', 'duplicate', 'blocked', 'oembed_pending', 'oembed_resolved', 'reconcile_required')),
  source_id TEXT REFERENCES x_manual_source_registry (source_id),
  oembed_attempt_id TEXT CHECK (oembed_attempt_id IS NULL),
  candidate_id TEXT,
  retention_expires_at TEXT NOT NULL,
  external_calls INTEGER NOT NULL DEFAULT 0 CHECK (external_calls = 0),
  media_publication_eligible INTEGER NOT NULL DEFAULT 0 CHECK (media_publication_eligible = 0),
  submit_operation_id TEXT NOT NULL REFERENCES internal_operation (operation_id),
  retire_operation_id TEXT REFERENCES internal_operation (operation_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX x_manual_submission_state_created_idx
  ON x_manual_submission (state, created_at DESC, submission_id);
CREATE INDEX x_manual_submission_source_created_idx
  ON x_manual_submission (source_id, created_at DESC, submission_id);

CREATE TABLE x_manual_write_permit (
  permit_id TEXT PRIMARY KEY CHECK (permit_id GLOB 'xpermit_[a-z0-9]*'),
  operation_id TEXT NOT NULL REFERENCES internal_operation (operation_id),
  submission_id TEXT NOT NULL CHECK (submission_id GLOB 'xsub_[a-z0-9]*'),
  mutation_kind TEXT NOT NULL CHECK (mutation_kind IN ('insert', 'retire')),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (operation_id, submission_id, mutation_kind)
) STRICT;

CREATE TRIGGER x_manual_operation_insert_guard
BEFORE INSERT ON x_manual_operation
WHEN NOT EXISTS (
  SELECT 1 FROM internal_operation o
  WHERE o.operation_id = NEW.operation_id
    AND o.state = 'requested'
    AND o.owner_process = 'admin_http'
    AND o.operation_kind = 'phase_control'
    AND o.capability_class = 'control'
    AND o.control_action = 'fence_update'
    AND o.egress_class = 'none'
    AND o.policy_id = 'p-phase-control-disabled'
    AND o.phase = 'disabled'
    AND o.candidate_id IS NULL
    AND o.source_id IS NULL
    AND o.publication_id IS NULL
    AND o.public_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_OPERATION_SHAPE');
END;

CREATE TRIGGER x_manual_operation_no_update
BEFORE UPDATE ON x_manual_operation
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER x_manual_operation_no_delete
BEFORE DELETE ON x_manual_operation
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_OPERATION_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_write_permit_insert_guard
BEFORE INSERT ON x_manual_write_permit
WHEN NOT EXISTS (
    SELECT 1 FROM x_manual_operation x
    JOIN internal_operation o ON o.operation_id = x.operation_id
    WHERE x.operation_id = NEW.operation_id
      AND o.state = 'authorized'
      AND o.owner_process = 'admin_http'
      AND o.egress_class = 'none'
      AND ((x.semantic_kind = 'x_submit' AND NEW.mutation_kind = 'insert')
        OR (x.semantic_kind = 'x_retire' AND NEW.mutation_kind = 'retire'))
      AND x.submission_id = NEW.submission_id
      AND x.expected_revision = NEW.expected_revision
  )
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_WRITE_PERMIT_REQUIRED');
END;

CREATE TRIGGER x_manual_write_permit_consume_guard
BEFORE UPDATE ON x_manual_write_permit
WHEN NEW.permit_id <> OLD.permit_id
  OR NEW.operation_id <> OLD.operation_id
  OR NEW.submission_id <> OLD.submission_id
  OR NEW.mutation_kind <> OLD.mutation_kind
  OR NEW.expected_revision <> OLD.expected_revision
  OR NEW.created_at <> OLD.created_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_WRITE_PERMIT_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_write_permit_no_delete
BEFORE DELETE ON x_manual_write_permit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_WRITE_PERMIT_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_submission_insert_guard
BEFORE INSERT ON x_manual_submission
WHEN NEW.revision <> 0
  OR NEW.state <> 'submitted'
  OR NEW.oembed_attempt_id IS NOT NULL
  OR NEW.external_calls <> 0
  OR NEW.media_publication_eligible <> 0
  OR NOT EXISTS (
    SELECT 1 FROM x_manual_write_permit p
    WHERE p.operation_id = NEW.submit_operation_id
      AND p.submission_id = NEW.submission_id
      AND p.mutation_kind = 'insert'
      AND p.expected_revision = 0
      AND p.consumed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM internal_operation o
        WHERE o.operation_id = p.operation_id AND o.state = 'authorized'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SUBMISSION_PERMIT_REQUIRED');
END;

CREATE TRIGGER x_manual_submission_transition_guard
BEFORE UPDATE ON x_manual_submission
WHEN NEW.submission_id <> OLD.submission_id
  OR NEW.revision <> OLD.revision + 1
  OR NEW.submitted_url <> OLD.submitted_url
  OR NEW.canonical_url <> OLD.canonical_url
  OR NEW.status_id <> OLD.status_id
  OR NEW.dedupe_key <> OLD.dedupe_key
  OR NEW.source_id IS NOT OLD.source_id
  OR NEW.candidate_id IS NOT OLD.candidate_id
  OR NEW.retention_expires_at <> OLD.retention_expires_at
  OR NEW.created_at <> OLD.created_at
  OR NEW.oembed_attempt_id IS NOT NULL
  OR NEW.external_calls <> 0
  OR NEW.media_publication_eligible <> 0
  OR NEW.submit_operation_id <> OLD.submit_operation_id
  OR OLD.retire_operation_id IS NOT NULL
  OR NEW.retire_operation_id IS NULL
  OR NEW.state <> 'retired'
  OR OLD.state NOT IN ('submitted', 'validated')
  OR NOT EXISTS (
    SELECT 1 FROM x_manual_write_permit p
    JOIN x_manual_operation x ON x.operation_id = p.operation_id
    JOIN internal_operation o ON o.operation_id = p.operation_id
    WHERE p.submission_id = OLD.submission_id
      AND p.mutation_kind = 'retire'
      AND p.expected_revision = OLD.revision
      AND p.consumed_at IS NULL
      AND x.semantic_kind = 'x_retire'
      AND x.submission_id = OLD.submission_id
      AND x.expected_revision = OLD.revision
      AND o.state = 'authorized'
      AND NEW.retire_operation_id = p.operation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SUBMISSION_TRANSITION');
END;

CREATE TRIGGER x_manual_submission_no_delete
BEFORE DELETE ON x_manual_submission
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SUBMISSION_APPEND_ONLY');
END;

CREATE TABLE x_manual_audit (
  audit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE CHECK (event_id GLOB 'xevt_[a-z0-9]*'),
  operation_id TEXT NOT NULL REFERENCES internal_operation (operation_id),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('requested', 'authorized', 'submitted', 'retired', 'succeeded', 'blocked')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR length(previous_event_hash) = 64),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX x_manual_audit_operation_created_idx
  ON x_manual_audit (operation_id, audit_seq);

CREATE TRIGGER x_manual_audit_insert_guard
BEFORE INSERT ON x_manual_audit
WHEN NOT EXISTS (SELECT 1 FROM x_manual_operation WHERE operation_id = NEW.operation_id)
  OR (NEW.event_kind = 'requested' AND EXISTS (
    SELECT 1 FROM x_manual_audit WHERE operation_id = NEW.operation_id
  ))
  OR (NEW.event_kind = 'authorized' AND NOT EXISTS (
    SELECT 1 FROM x_manual_audit
    WHERE operation_id = NEW.operation_id AND event_kind = 'requested'
  ))
  OR (NEW.event_kind IN ('submitted', 'retired') AND NOT EXISTS (
    SELECT 1 FROM x_manual_audit
    WHERE operation_id = NEW.operation_id AND event_kind = 'authorized'
  ))
  OR (NEW.event_kind = 'succeeded' AND NOT EXISTS (
    SELECT 1 FROM x_manual_audit
    WHERE operation_id = NEW.operation_id
      AND event_kind = CASE
        WHEN (SELECT semantic_kind FROM x_manual_operation WHERE operation_id = NEW.operation_id) = 'x_submit'
        THEN 'submitted' ELSE 'retired' END
  ))
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_AUDIT_OPERATION_REQUIRED');
END;

CREATE TRIGGER x_manual_audit_no_update
BEFORE UPDATE ON x_manual_audit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_audit_no_delete
BEFORE DELETE ON x_manual_audit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_AUDIT_APPEND_ONLY');
END;

INSERT INTO migration_0008_assert (value)
SELECT CASE WHEN
  (SELECT count(*) FROM x_manual_source_registry) = 59
  AND (SELECT count(*) FROM x_manual_source_registry WHERE enabled = 0) = 59
  AND (SELECT count(*) FROM x_manual_source_registry WHERE lifecycle_status = 'proposed') = 59
  AND (SELECT count(*) FROM x_manual_source_registry WHERE collection_mode = 'manual_url') = 59
  AND NOT EXISTS (SELECT 1 FROM x_manual_submission)
  AND NOT EXISTS (SELECT 1 FROM x_manual_operation)
  THEN 1 ELSE 0 END;

PRAGMA user_version = 8;
DROP TABLE migration_0008_assert;
COMMIT;
