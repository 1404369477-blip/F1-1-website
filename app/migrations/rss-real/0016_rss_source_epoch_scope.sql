-- Immutable successor to 0014; registry-local clocks and runtime-global clocks
-- remain separate. Old receipts are not backfilled or promoted.
CREATE TABLE rss_automatic_source_binding_v1 (
 fence_receipt_id TEXT PRIMARY KEY REFERENCES generic_fence_receipt(fence_receipt_id),
 issued_by_operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id),
 source_id TEXT NOT NULL REFERENCES source(source_id),
 registry_revision INTEGER NOT NULL CHECK(registry_revision>=1),
 identity_sha256 TEXT NOT NULL CHECK(length(identity_sha256)=64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'),
 config_revision INTEGER NOT NULL CHECK(config_revision>=1),
 source_stop_epoch INTEGER NOT NULL CHECK(source_stop_epoch>=1),
 source_config_epoch INTEGER NOT NULL CHECK(source_config_epoch>=1),
 source_safety_epoch INTEGER NOT NULL CHECK(source_safety_epoch>=1),
 authorization_version INTEGER NOT NULL CHECK(authorization_version>=1),
 policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
 recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
 authorization_receipt_sha256 TEXT NOT NULL CHECK(length(authorization_receipt_sha256)=64 AND authorization_receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_policy_sha256 TEXT NOT NULL CHECK(length(source_policy_sha256)=64 AND source_policy_sha256 NOT GLOB '*[^0-9a-f]*'),
 authorization_expires_at TEXT NOT NULL,
 rights_status TEXT NOT NULL,
 media_policy TEXT NOT NULL
) STRICT;
CREATE TRIGGER rss_automatic_source_binding_no_update BEFORE UPDATE ON rss_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER rss_automatic_source_binding_no_delete BEFORE DELETE ON rss_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER rss_automatic_source_binding_insert_guard BEFORE INSERT ON rss_automatic_source_binding_v1
WHEN NOT EXISTS (
 SELECT 1 FROM generic_fence_receipt f JOIN internal_operation op ON op.operation_id=f.issued_by_operation_id
 JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
 JOIN source s ON s.source_id=op.source_id JOIN source_registry_v1 r ON r.source_id=s.source_id
 JOIN source_registry_rss_config_current cfg ON cfg.source_id=s.source_id
 WHERE f.fence_receipt_id=NEW.fence_receipt_id AND f.issued_by_operation_id=NEW.issued_by_operation_id
 AND NEW.source_id=s.source_id AND f.reason_code IN ('RSS_AUTOMATIC_CURRENT_V1','RSS_AUTOMATIC_COMMITTED_DELIVERY_V1')
 AND f.issuer='f1plus1-system-supervisor-v1' AND f.state='clear'
 AND op.state='authorized' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
 AND op.capability_class='control' AND op.control_action='fence_update'
 AND op.policy_id IN ('p-rss-auto-fence-live','p-rss-auto-fence-backlog')
 AND h.owner_process=op.owner_process AND h.consumed_by_operation_id=op.operation_id
 AND h.release_sha256=op.expected_release_sha256 AND h.manifest_sha256=op.expected_manifest_sha256
 AND s.stop_epoch=op.source_stop_epoch
 AND EXISTS(SELECT 1 FROM operation_entity_binding binding WHERE binding.operation_id=op.operation_id
   AND binding.entity_kind='source' AND binding.entity_id=s.source_id AND binding.identity_selector='source_id'
   AND binding.expected_entity_version=r.revision AND binding.expected_entity_hash=r.identity_sha256)
 AND NEW.registry_revision=r.revision
 AND NEW.identity_sha256=r.identity_sha256
 AND NEW.config_revision=cfg.source_revision
 AND NEW.source_stop_epoch=s.stop_epoch
 AND NEW.source_config_epoch=r.source_config_epoch
 AND NEW.source_safety_epoch=r.source_safety_epoch
 AND NEW.authorization_version=r.authorization_version
 AND NEW.policy_epoch=r.policy_epoch
 AND NEW.recovery_epoch=r.recovery_epoch
 AND NEW.authorization_receipt_sha256=cfg.authorization_receipt_sha256
 AND NEW.source_policy_sha256=cfg.source_policy_sha256
 AND NEW.authorization_expires_at=r.authorization_expires_at
 AND NEW.rights_status=cfg.rights_status
 AND NEW.media_policy=cfg.media_policy
) BEGIN SELECT RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_UNAUTHORIZED'); END;
CREATE TRIGGER rss_automatic_source_binding_capture AFTER INSERT ON generic_fence_receipt
WHEN NEW.reason_code IN ('RSS_AUTOMATIC_CURRENT_V1','RSS_AUTOMATIC_COMMITTED_DELIVERY_V1')
BEGIN
 INSERT INTO rss_automatic_source_binding_v1
 SELECT NEW.fence_receipt_id,NEW.issued_by_operation_id,s.source_id,
  r.revision,
  r.identity_sha256,
  cfg.source_revision,
  s.stop_epoch,
  r.source_config_epoch,
  r.source_safety_epoch,
  r.authorization_version,
  r.policy_epoch,
  r.recovery_epoch,
  cfg.authorization_receipt_sha256,
  cfg.source_policy_sha256,
  r.authorization_expires_at,
  cfg.rights_status,
  cfg.media_policy
 FROM internal_operation op JOIN source s ON s.source_id=op.source_id
 JOIN source_registry_v1 r ON r.source_id=s.source_id
 JOIN source_registry_rss_config_current cfg ON cfg.source_id=s.source_id
 WHERE op.operation_id=NEW.issued_by_operation_id;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rss_automatic_source_binding_v1 WHERE fence_receipt_id=NEW.fence_receipt_id)
   THEN RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_MISSING') END;
END;
CREATE VIEW rss_automatic_source_binding_current_v1 AS
SELECT binding.* FROM rss_automatic_source_binding_v1 binding
JOIN source s ON s.source_id=binding.source_id
JOIN source_registry_v1 r ON r.source_id=s.source_id
JOIN source_registry_rss_config_current cfg ON cfg.source_id=s.source_id
WHERE binding.registry_revision=r.revision
 AND binding.identity_sha256=r.identity_sha256
 AND binding.config_revision=cfg.source_revision
 AND binding.source_stop_epoch=s.stop_epoch
 AND binding.source_config_epoch=r.source_config_epoch
 AND binding.source_safety_epoch=r.source_safety_epoch
 AND binding.authorization_version=r.authorization_version
 AND binding.policy_epoch=r.policy_epoch
 AND binding.recovery_epoch=r.recovery_epoch
 AND binding.authorization_receipt_sha256=cfg.authorization_receipt_sha256
 AND binding.source_policy_sha256=cfg.source_policy_sha256
 AND binding.authorization_expires_at=r.authorization_expires_at
 AND binding.rights_status=cfg.rights_status
 AND binding.media_policy=cfg.media_policy;

DROP VIEW rss_automatic_fence_current_v1;
CREATE VIEW rss_automatic_fence_current_v1 AS
SELECT f.*,op.candidate_id,op.source_id,op.publication_id,
       op.expected_entity_version AS source_revision,op.expected_entity_hash AS input_content_hash
FROM generic_fence_receipt f
JOIN rss_automatic_source_binding_current_v1 sb ON sb.fence_receipt_id=f.fence_receipt_id AND sb.issued_by_operation_id=f.issued_by_operation_id
JOIN internal_operation op ON op.operation_id=f.issued_by_operation_id
JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
JOIN pending_review_candidate c ON c.candidate_id=op.candidate_id AND c.source_id=op.source_id
JOIN source s ON s.source_id=c.source_id
JOIN source_registry_v1 r ON r.source_id=c.source_id
JOIN source_registry_rss_config_current cfg ON cfg.source_id=c.source_id
JOIN internal_control ctl ON ctl.singleton_id=1
WHERE f.reason_code='RSS_AUTOMATIC_CURRENT_V1' AND f.issuer='f1plus1-system-supervisor-v1' AND f.state='clear'
AND op.state='succeeded' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
AND op.capability_class='control' AND op.control_action='fence_update'
AND op.policy_id IN ('p-rss-auto-fence-live','p-rss-auto-fence-backlog')
AND h.owner_process=op.owner_process AND h.consumed_by_operation_id=op.operation_id
AND h.release_sha256=op.expected_release_sha256 AND h.manifest_sha256=op.expected_manifest_sha256
AND c.source_revision=op.expected_entity_version AND c.source_payload_hash=op.expected_entity_hash
AND op.source_config_epoch=ctl.source_config_epoch AND op.source_safety_epoch=ctl.source_safety_epoch
AND op.authorization_version=ctl.authorization_version AND op.policy_epoch=ctl.policy_epoch
AND op.recovery_epoch=ctl.recovery_epoch AND op.expected_writer_epoch=ctl.writer_epoch
AND f.policy_epoch=op.policy_epoch AND f.recovery_epoch=op.recovery_epoch AND f.writer_epoch=op.expected_writer_epoch
AND s.enabled=1 AND s.stop_epoch=op.source_stop_epoch AND r.enabled=1 AND r.source_kind='rss'
AND r.lifecycle_status='active' AND r.collection_onboarding_status='active' AND r.source_stop_status='clear'
AND r.current_operation_id IS NULL AND r.revision=cfg.source_revision
AND r.normalization_status='valid' AND r.dedup_status IN ('unique','linked_existing')
AND r.monitorability='monitorable' AND r.adapter_status='ready' AND r.adapter_authorization_status='valid' AND r.platform_allowed='allowed'
AND cfg.rights_status='clear' AND cfg.media_policy IN ('allowlisted','zero_media') AND r.authorization_expires_at>=f.expires_at
AND EXISTS(SELECT 1 FROM operation_entity_binding source_binding WHERE source_binding.operation_id=op.operation_id
 AND source_binding.entity_kind='source' AND source_binding.entity_id=c.source_id AND source_binding.identity_selector='source_id'
 AND source_binding.expected_entity_version=r.revision AND source_binding.expected_entity_hash=r.identity_sha256)
AND ((f.scope_kind='candidate' AND f.scope_id=c.candidate_id)
 OR (f.scope_kind='source' AND f.scope_id=c.source_id)
 OR (f.scope_kind='publication' AND f.scope_id=op.publication_id AND EXISTS(
   SELECT 1 FROM publication p JOIN review_bundle b ON b.bundle_id=p.bundle_id
   WHERE p.publication_id=op.publication_id AND b.candidate_id=c.candidate_id
   AND b.source_revision=c.source_revision AND b.source_payload_hash=c.source_payload_hash
   AND b.bundle_revision=(SELECT MAX(latest.bundle_revision) FROM review_bundle latest WHERE latest.candidate_id=c.candidate_id) AND p.approved_bundle_hash=b.bundle_hash
   AND p.publication_status IN ('queued','published'))))
AND EXISTS(SELECT 1 FROM operation_entity_binding b WHERE b.operation_id=op.operation_id
 AND b.entity_kind='candidate' AND b.entity_id=c.candidate_id AND b.identity_selector='candidate_id'
 AND b.expected_entity_version=c.source_revision AND b.expected_entity_hash=c.source_payload_hash);
