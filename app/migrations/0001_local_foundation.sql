-- VS-0 foundation only. Domain Source/Content tables wait for the data-team
-- revision that resolves M3 33-column to Source 39-column canonical mapping.
CREATE TABLE IF NOT EXISTS migration_ledger (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  sqlite_version TEXT NOT NULL,
  migration_sha256 TEXT NOT NULL,
  append_only INTEGER NOT NULL CHECK (append_only = 1)
);

CREATE TABLE IF NOT EXISTS fixture_seed_ledger (
  seed_id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL,
  source_artifact_sha256 TEXT NOT NULL,
  field_count INTEGER NOT NULL CHECK (field_count > 0),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  enabled_false_count INTEGER NOT NULL CHECK (enabled_false_count >= 0),
  writes_to_base INTEGER NOT NULL CHECK (writes_to_base = 0),
  data_gate TEXT NOT NULL CHECK (data_gate = 'blocked-by-data'),
  recorded_at TEXT NOT NULL
);
