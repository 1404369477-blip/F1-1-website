-- Additive RSS automation authority. The migration runner pins predecessor and
-- successor fingerprints and requires an offline, stopped schema-10 database.
DROP TRIGGER internal_operation_policy_no_insert;
DROP TRIGGER internal_control_action_policy_no_insert;
DROP TRIGGER internal_required_fence_policy_no_insert;
DROP TRIGGER gateway_entity_policy_no_insert;
INSERT INTO internal_operation_policy VALUES
('p-rss-auto-fence-live','system_supervisor','system_producer','control','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-rss-auto-fence-backlog','system_supervisor','system_producer','control','backlog','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-refine-rss-store-live','rss_refiner','refine','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear'),
('p-refine-rss-store-backlog','rss_refiner','refine','db_mutation','backlog','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');
INSERT INTO internal_control_action_policy VALUES
('p-rss-auto-fence-live','system_supervisor','system_producer','control','fence_update'),
('p-rss-auto-fence-backlog','system_supervisor','system_producer','control','fence_update');
INSERT INTO internal_required_fence_policy VALUES
('p-refine-rss-store-live','candidate_id','publication','clear'),
('p-refine-rss-store-backlog','candidate_id','publication','clear');
INSERT INTO gateway_entity_policy VALUES ('refine','db_mutation','machine_draft','insert','bound_child');
CREATE TRIGGER internal_operation_policy_no_insert BEFORE INSERT ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_control_action_policy_no_insert BEFORE INSERT ON internal_control_action_policy BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;
CREATE TRIGGER internal_required_fence_policy_no_insert BEFORE INSERT ON internal_required_fence_policy BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;
CREATE TRIGGER gateway_entity_policy_no_insert BEFORE INSERT ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

-- All new receipts retain their immutable issuer's content identity. Source
-- receipts are deliberately candidate-specific even though their scope is source.
CREATE VIEW rss_automatic_fence_current_v1 AS
SELECT f.*,op.candidate_id,op.source_id,op.publication_id,
       op.expected_entity_version AS source_revision,op.expected_entity_hash AS input_content_hash
FROM generic_fence_receipt f
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
AND r.source_config_epoch=ctl.source_config_epoch AND r.source_safety_epoch=ctl.source_safety_epoch
AND r.authorization_version=ctl.authorization_version AND r.policy_epoch=ctl.policy_epoch AND r.recovery_epoch=ctl.recovery_epoch
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

CREATE TRIGGER rss_automatic_fence_issuer_guard_v1 BEFORE INSERT ON generic_fence_receipt
WHEN NEW.reason_code='RSS_AUTOMATIC_CURRENT_V1' AND NOT EXISTS(
 SELECT 1 FROM internal_operation op JOIN pending_review_candidate c ON c.candidate_id=op.candidate_id AND c.source_id=op.source_id
 WHERE op.operation_id=NEW.issued_by_operation_id AND op.state='authorized'
 AND op.policy_id IN ('p-rss-auto-fence-live','p-rss-auto-fence-backlog')
 AND c.source_revision=op.expected_entity_version AND c.source_payload_hash=op.expected_entity_hash
 AND ((NEW.scope_kind='candidate' AND NEW.scope_id=c.candidate_id)
 OR (NEW.scope_kind='source' AND NEW.scope_id=c.source_id)
 OR (NEW.scope_kind='publication' AND NEW.scope_id=op.publication_id)))
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_FENCE_IDENTITY_INVALID'); END;

CREATE TRIGGER rss_automatic_fence_consumer_guard_v1 BEFORE INSERT ON operation_fence_binding
WHEN EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id
 AND op.owner_process IN ('automatic_reviewer','automatic_publisher'))
 AND NOT EXISTS(SELECT 1 FROM rss_automatic_fence_current_v1 f JOIN internal_operation op ON op.operation_id=NEW.operation_id
 WHERE f.fence_receipt_id=NEW.fence_receipt_id AND f.candidate_id=op.candidate_id AND f.source_id=op.source_id)
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_FENCE_CURRENT_REQUIRED'); END;
