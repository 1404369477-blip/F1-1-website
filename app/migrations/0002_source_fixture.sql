-- VS-0 only: the accepted 59x39 local Source projection.
-- The physical column list follows Source.required exactly; validation and
-- canonical projection checks remain in the repository layer.
CREATE TABLE IF NOT EXISTS source_config_fixture (
  source_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'instagram', 'reddit', 'website', 'rss')),
  platform_account_id TEXT,
  handle TEXT NOT NULL,
  raw_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  canonical_url_valid INTEGER NOT NULL CHECK (canonical_url_valid IN (0, 1)),
  normalizer_version TEXT NOT NULL,
  normalization_status TEXT NOT NULL CHECK (normalization_status IN ('pending', 'valid', 'invalid', 'needs_review')),
  dedup_status TEXT NOT NULL CHECK (dedup_status IN ('pending', 'unique', 'linked_existing', 'needs_review')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('official_org_team_event', 'driver_or_manager', 'journalist_commentator_media', 'fan_news_aggregator', 'image_entertainment_other')),
  content_focus TEXT NOT NULL CHECK (content_focus IN ('team_or_series_updates', 'driver_or_manager_updates', 'journalism_commentary', 'fan_news_aggregation', 'visual_entertainment_or_other')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'confirmed', 'rejected')),
  identity_status TEXT NOT NULL CHECK (identity_status IN ('unknown', 'verified', 'needs_review')),
  relevance_status TEXT NOT NULL CHECK (relevance_status IN ('unknown', 'qualified', 'rejected')),
  monitorability TEXT NOT NULL CHECK (monitorability IN ('unknown', 'monitorable', 'restricted', 'unavailable')),
  adapter_status TEXT NOT NULL CHECK (adapter_status IN ('unchecked', 'ready', 'missing', 'unavailable')),
  adapter_authorization_status TEXT NOT NULL CHECK (adapter_authorization_status IN ('unknown', 'valid', 'invalid', 'expired')),
  platform_allowed TEXT NOT NULL CHECK (platform_allowed IN ('unknown', 'allowed', 'blocked')),
  authorization_checked_at TEXT,
  authorization_expires_at TEXT,
  collection_onboarding_status TEXT NOT NULL CHECK (collection_onboarding_status IN ('validating', 'activation_pending', 'queued', 'collecting', 'active', 'normalization_failed', 'dedup_needs_review', 'linked_existing', 'blocked_adapter_missing', 'blocked_authorization', 'blocked_platform', 'queue_failed', 'collection_failed', 'stopped', 'cancelled', 'dead_letter')),
  onboarding_operation_id TEXT,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('proposed', 'active', 'paused', 'retired')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  manual_disable_at TEXT,
  source_stop_status TEXT NOT NULL CHECK (source_stop_status IN ('clear', 'manual', 'compliance', 'authorization', 'platform')),
  source_safety_epoch INTEGER NOT NULL CHECK (source_safety_epoch >= 1),
  source_config_epoch INTEGER NOT NULL CHECK (source_config_epoch >= 1),
  added_at TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  notes TEXT NOT NULL,
  migration_batch_id TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_ref TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS source_config_fixture_canonical_unique
  ON source_config_fixture (canonical_url)
  WHERE canonical_url_valid = 1 AND dedup_status = 'unique';

CREATE INDEX IF NOT EXISTS source_config_fixture_status_idx
  ON source_config_fixture (collection_onboarding_status, source_stop_status);

CREATE INDEX IF NOT EXISTS source_config_fixture_lifecycle_idx
  ON source_config_fixture (lifecycle_status, enabled);

CREATE INDEX IF NOT EXISTS source_config_fixture_epoch_idx
  ON source_config_fixture (source_config_epoch, source_safety_epoch);

CREATE TABLE IF NOT EXISTS source_seed_ledger (
  seed_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  source_artifact_sha256 TEXT NOT NULL,
  projection_sha256 TEXT NOT NULL,
  field_count INTEGER NOT NULL CHECK (field_count = 39),
  row_count INTEGER NOT NULL CHECK (row_count = 59),
  enabled_false_count INTEGER NOT NULL CHECK (enabled_false_count = 59),
  writes_to_base INTEGER NOT NULL CHECK (writes_to_base = 0),
  data_gate TEXT NOT NULL CHECK (data_gate = 'accepted-local-fixture'),
  legacy_gate_status TEXT NOT NULL CHECK (legacy_gate_status = 'legacy-reject'),
  recorded_at TEXT NOT NULL
);
