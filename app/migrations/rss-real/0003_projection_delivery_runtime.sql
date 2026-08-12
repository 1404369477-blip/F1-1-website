CREATE TABLE projection_delivery_receipt (
  delivery_id TEXT PRIMARY KEY REFERENCES projection_outbox(delivery_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  snapshot_generation INTEGER NOT NULL CHECK (snapshot_generation >= 1),
  snapshot_manifest_hash TEXT NOT NULL CHECK (length(snapshot_manifest_hash) = 64 AND snapshot_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object'),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_status TEXT NOT NULL CHECK (receipt_status IN ('active', 'superseded')),
  received_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  UNIQUE (snapshot_generation, snapshot_manifest_hash)
) STRICT;

CREATE INDEX projection_outbox_sender_idx
  ON projection_outbox(status, lease_expires_at, created_at, delivery_id);

CREATE TRIGGER projection_outbox_runtime_insert_guard
BEFORE INSERT ON projection_outbox
WHEN NEW.max_attempts <> 3
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_RUNTIME_INVALID');
END;

CREATE TRIGGER projection_outbox_lease_runtime_guard
BEFORE UPDATE ON projection_outbox
WHEN NEW.status = 'leased' AND (
  OLD.status NOT IN ('pending', 'retryable_failed') OR
  unixepoch(NEW.lease_expires_at) - unixepoch(NEW.updated_at) <> 60
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_LEASE_INVALID');
END;

CREATE TRIGGER projection_delivery_receipt_guard_insert
BEFORE INSERT ON projection_delivery_receipt
WHEN NOT EXISTS (
  SELECT 1
  FROM projection_outbox AS delivery
  WHERE delivery.delivery_id = NEW.delivery_id
    AND delivery.status IN ('leased', 'reconcile_wait')
    AND delivery.snapshot_generation = NEW.snapshot_generation
    AND delivery.snapshot_manifest_hash = NEW.snapshot_manifest_hash
    AND json_extract(NEW.receipt_json, '$.schemaVersion') = 'admin-public-projection-receipt-v1'
    AND json_extract(NEW.receipt_json, '$.deliveryId') = NEW.delivery_id
    AND json_extract(NEW.receipt_json, '$.snapshotGeneration') = NEW.snapshot_generation
    AND json_extract(NEW.receipt_json, '$.snapshotManifestHash') = NEW.snapshot_manifest_hash
    AND json_extract(NEW.receipt_json, '$.status') = NEW.receipt_status
    AND json_extract(NEW.receipt_json, '$.receivedAt') = NEW.received_at
    AND json_extract(NEW.receipt_json, '$.activatedAt') = NEW.activated_at
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_INVALID');
END;

CREATE TRIGGER projection_outbox_success_requires_receipt
BEFORE UPDATE OF status ON projection_outbox
WHEN NEW.status = 'succeeded' AND NOT EXISTS (
  SELECT 1 FROM projection_delivery_receipt AS receipt
  WHERE receipt.delivery_id = NEW.delivery_id
    AND receipt.snapshot_generation = NEW.snapshot_generation
    AND receipt.snapshot_manifest_hash = NEW.snapshot_manifest_hash
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_REQUIRED');
END;

CREATE TRIGGER projection_delivery_receipt_no_update
BEFORE UPDATE ON projection_delivery_receipt
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_IMMUTABLE');
END;

CREATE TRIGGER projection_delivery_receipt_no_delete
BEFORE DELETE ON projection_delivery_receipt
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_IMMUTABLE');
END;

PRAGMA user_version = 3;
