-- Exact ae757 RSS successor; offline runner owns closed-state transaction.

-- Original rows and unchanged security object SQL are verified after migration.

DROP TRIGGER "admin_operation_no_delete";

DROP TRIGGER "admin_operation_no_update";

DROP TRIGGER "audit_event_guard_insert";

DROP TRIGGER "audit_event_no_delete";

DROP TRIGGER "audit_event_no_update";

DROP TRIGGER "audit_event_predecessor_guard";

DROP TRIGGER "audit_event_sequence_guard";

DROP TRIGGER "backup_recovery_point_insert_guard";

DROP TRIGGER "backup_recovery_point_no_delete";

DROP TRIGGER "backup_recovery_point_no_update";

DROP TRIGGER "bilingual_active_pointer_insert_guard";

DROP TRIGGER "bilingual_active_pointer_no_delete";

DROP TRIGGER "bilingual_active_pointer_transition_guard";

DROP TRIGGER "bilingual_approval_insert_guard";

DROP TRIGGER "bilingual_approval_no_delete";

DROP TRIGGER "bilingual_approval_no_update";

DROP TRIGGER "bilingual_authority_audit_no_delete";

DROP TRIGGER "bilingual_authority_audit_no_update";

DROP TRIGGER "bilingual_authority_bridge_marker_insert_guard";

DROP TRIGGER "bilingual_authority_bridge_marker_no_delete";

DROP TRIGGER "bilingual_authority_bridge_marker_update_guard";

DROP TRIGGER "bilingual_authority_capability_v1_no_delete";

DROP TRIGGER "bilingual_authority_capability_v1_no_insert";

DROP TRIGGER "bilingual_authority_permit_insert_guard";

DROP TRIGGER "bilingual_authority_permit_no_delete";

DROP TRIGGER "bilingual_authority_permit_update_guard";

DROP TRIGGER "bilingual_authority_schema10_bridge_only";

DROP TRIGGER "bilingual_authority_transition_consume";

DROP TRIGGER "bilingual_authority_transition_guard";

DROP TRIGGER "bilingual_bundle_insert_guard";

DROP TRIGGER "bilingual_bundle_no_delete";

DROP TRIGGER "bilingual_bundle_no_update";

DROP TRIGGER "bilingual_draft_insert_guard";

DROP TRIGGER "bilingual_draft_no_delete";

DROP TRIGGER "bilingual_draft_no_update";

DROP TRIGGER "bilingual_lineage_insert_guard";

DROP TRIGGER "bilingual_lineage_no_delete";

DROP TRIGGER "bilingual_lineage_safety_decision_apply";

DROP TRIGGER "bilingual_lineage_safety_decision_insert_guard";

DROP TRIGGER "bilingual_lineage_safety_decision_no_delete";

DROP TRIGGER "bilingual_lineage_safety_decision_no_update";

DROP TRIGGER "bilingual_lineage_transition_guard";

DROP TRIGGER "bilingual_operation_link_insert_guard";

DROP TRIGGER "bilingual_operation_link_no_delete";

DROP TRIGGER "bilingual_operation_link_no_update";

DROP TRIGGER "bilingual_outbox_insert_guard";

DROP TRIGGER "bilingual_outbox_no_delete";

DROP TRIGGER "bilingual_outbox_transition_guard";

DROP TRIGGER "bilingual_projection_insert_guard";

DROP TRIGGER "bilingual_projection_no_delete";

DROP TRIGGER "bilingual_projection_transition_guard";

DROP TRIGGER "bilingual_publication_insert_guard";

DROP TRIGGER "bilingual_publication_no_delete";

DROP TRIGGER "bilingual_publication_transition_guard";

DROP TRIGGER "bilingual_receipt_insert_guard";

DROP TRIGGER "bilingual_receipt_no_delete";

DROP TRIGGER "bilingual_receipt_no_update";

DROP TRIGGER "bilingual_slot_insert_guard";

DROP TRIGGER "bilingual_slot_no_delete";

DROP TRIGGER "bilingual_slot_transition_guard";

DROP TRIGGER "budget_account_no_delete";

DROP TRIGGER "budget_account_update_guard";

DROP TRIGGER "budget_reservation_account_consume";

DROP TRIGGER "budget_reservation_account_release";

DROP TRIGGER "budget_reservation_account_reserve";

DROP TRIGGER "budget_reservation_insert_guard";

DROP TRIGGER "budget_reservation_no_delete";

DROP TRIGGER "budget_reservation_transition_guard";

DROP TRIGGER "gateway_admin_operation_insert_guard";

DROP TRIGGER "gateway_audit_event_insert_guard";

DROP TRIGGER "gateway_candidate_delete_guard";

DROP TRIGGER "gateway_candidate_insert_guard";

DROP TRIGGER "gateway_candidate_update_guard";

DROP TRIGGER "gateway_entity_policy_no_delete";

DROP TRIGGER "gateway_entity_policy_no_insert";

DROP TRIGGER "gateway_entity_policy_no_update";

DROP TRIGGER "gateway_ingest_run_delete_guard";

DROP TRIGGER "gateway_ingest_run_insert_guard";

DROP TRIGGER "gateway_ingest_run_update_guard";

DROP TRIGGER "gateway_machine_draft_insert_guard";

DROP TRIGGER "gateway_projection_insert_guard";

DROP TRIGGER "gateway_projection_outbox_insert_guard";

DROP TRIGGER "gateway_projection_outbox_update_guard";

DROP TRIGGER "gateway_projection_receipt_insert_guard";

DROP TRIGGER "gateway_publication_insert_guard";

DROP TRIGGER "gateway_publication_update_guard";

DROP TRIGGER "gateway_review_bundle_insert_guard";

DROP TRIGGER "gateway_review_decision_insert_guard";

DROP TRIGGER "gateway_rss_media_insert_guard";

DROP TRIGGER "gateway_source_delete_guard";

DROP TRIGGER "gateway_source_insert_guard";

DROP TRIGGER "gateway_source_update_guard";

DROP TRIGGER "gateway_write_permit_insert_guard";

DROP TRIGGER "gateway_write_permit_no_delete";

DROP TRIGGER "gateway_write_permit_update_guard";

DROP TRIGGER "generic_fence_receipt_insert_guard";

DROP TRIGGER "generic_fence_receipt_no_delete";

DROP TRIGGER "generic_fence_receipt_no_update";

DROP TRIGGER "internal_control_action_policy_no_delete";

DROP TRIGGER "internal_control_action_policy_no_insert";

DROP TRIGGER "internal_control_action_policy_no_update";

DROP TRIGGER "internal_control_transition_guard";

DROP TRIGGER "internal_external_attempt_budget_guard";

DROP TRIGGER "internal_external_attempt_insert_guard";

DROP TRIGGER "internal_external_attempt_no_delete";

DROP TRIGGER "internal_external_attempt_transition_guard";

DROP TRIGGER "internal_external_attempt_unknown_guard";

DROP TRIGGER "internal_operation_audit_no_delete";

DROP TRIGGER "internal_operation_audit_no_update";

DROP TRIGGER "internal_operation_audit_predecessor_guard";

DROP TRIGGER "internal_operation_authorize_guard";

DROP TRIGGER "internal_operation_fence_terminal_guard";

DROP TRIGGER "internal_operation_insert_guard";

DROP TRIGGER "internal_operation_no_delete";

DROP TRIGGER "internal_operation_outbox_no_delete";

DROP TRIGGER "internal_operation_outbox_transition_guard";

DROP TRIGGER "internal_operation_policy_no_delete";

DROP TRIGGER "internal_operation_policy_no_insert";

DROP TRIGGER "internal_operation_policy_no_update";

DROP TRIGGER "internal_operation_transition_guard";

DROP TRIGGER "internal_required_fence_policy_no_delete";

DROP TRIGGER "internal_required_fence_policy_no_insert";

DROP TRIGGER "internal_required_fence_policy_no_update";

DROP TRIGGER "machine_summary_draft_insert_guard";

DROP TRIGGER "machine_summary_draft_no_delete";

DROP TRIGGER "machine_summary_draft_no_update";

DROP TRIGGER "operation_entity_binding_insert_guard";

DROP TRIGGER "operation_entity_binding_no_delete";

DROP TRIGGER "operation_entity_binding_no_update";

DROP TRIGGER "operation_fence_binding_insert_guard";

DROP TRIGGER "operation_fence_binding_no_delete";

DROP TRIGGER "operation_fence_binding_update_guard";

DROP TRIGGER "owner_authorization_handoff_no_delete";

DROP TRIGGER "owner_authorization_handoff_update_guard";

DROP TRIGGER "projection_delivery_receipt_guard_insert";

DROP TRIGGER "projection_delivery_receipt_no_delete";

DROP TRIGGER "projection_delivery_receipt_no_update";

DROP TRIGGER "projection_outbox_guard_insert";

DROP TRIGGER "projection_outbox_identity_no_update";

DROP TRIGGER "projection_outbox_lease_runtime_guard";

DROP TRIGGER "projection_outbox_no_delete";

DROP TRIGGER "projection_outbox_runtime_insert_guard";

DROP TRIGGER "projection_outbox_status_transition_guard";

DROP TRIGGER "projection_outbox_success_requires_receipt";

DROP TRIGGER "projection_recovery_anchor_insert_guard";

DROP TRIGGER "projection_recovery_anchor_no_delete";

DROP TRIGGER "projection_recovery_anchor_update_guard";

DROP TRIGGER "publication_guard_insert";

DROP TRIGGER "publication_identity_no_update";

DROP TRIGGER "publication_no_delete";

DROP TRIGGER "publication_published_at_guard";

DROP TRIGGER "publication_status_transition_guard";

DROP TRIGGER "published_projection_guard_insert";

DROP TRIGGER "published_projection_no_delete";

DROP TRIGGER "published_projection_no_update";

DROP TRIGGER "quick_launch_authority_audit_no_delete";

DROP TRIGGER "quick_launch_authority_audit_no_update";

DROP TRIGGER "quick_launch_authority_no_delete";

DROP TRIGGER "quick_launch_authority_no_insert";

DROP TRIGGER "quick_launch_authority_permit_insert_guard";

DROP TRIGGER "quick_launch_authority_permit_no_delete";

DROP TRIGGER "quick_launch_authority_permit_update_guard";

DROP TRIGGER "quick_launch_authority_transition_consume";

DROP TRIGGER "quick_launch_authority_transition_guard";

DROP TRIGGER "review_bundle_guard_insert";

DROP TRIGGER "review_bundle_no_delete";

DROP TRIGGER "review_bundle_no_update";

DROP TRIGGER "review_decision_guard_insert";

DROP TRIGGER "review_decision_no_delete";

DROP TRIGGER "review_decision_no_update";

DROP TRIGGER "route_registry_no_delete";

DROP TRIGGER "route_registry_no_update";

DROP TRIGGER "rss_automatic_fence_consumer_guard_v1";

DROP TRIGGER "rss_automatic_fence_issuer_guard_v1";

DROP TRIGGER "rss_automatic_source_binding_capture";

DROP TRIGGER "rss_automatic_source_binding_insert_guard";

DROP TRIGGER "rss_automatic_source_binding_no_delete";

DROP TRIGGER "rss_automatic_source_binding_no_update";

DROP TRIGGER "rss_media_candidate_insert_guard";

DROP TRIGGER "rss_media_candidate_no_delete";

DROP TRIGGER "rss_media_candidate_no_update";

DROP TRIGGER "source_registry_health_no_delete";

DROP TRIGGER "source_registry_health_no_update";

DROP TRIGGER "source_registry_health_x_zero_guard";

DROP TRIGGER "source_registry_history_no_delete";

DROP TRIGGER "source_registry_history_no_update";

DROP TRIGGER "source_registry_insert_effects";

DROP TRIGGER "source_registry_insert_guard";

DROP TRIGGER "source_registry_migration_identity_no_delete";

DROP TRIGGER "source_registry_migration_identity_no_update";

DROP TRIGGER "source_registry_mutation_permit_insert_guard";

DROP TRIGGER "source_registry_mutation_permit_no_delete";

DROP TRIGGER "source_registry_mutation_permit_update_guard";

DROP TRIGGER "source_registry_no_delete";

DROP TRIGGER "source_registry_outbox_insert_guard";

DROP TRIGGER "source_registry_outbox_no_delete";

DROP TRIGGER "source_registry_outbox_transition_guard";

DROP TRIGGER "source_registry_rss_config_no_delete";

DROP TRIGGER "source_registry_rss_config_no_update";

DROP TRIGGER "source_registry_rss_config_v2_identity_no_delete";

DROP TRIGGER "source_registry_rss_config_v2_identity_no_update";

DROP TRIGGER "source_registry_rss_config_v2_insert_guard";

DROP TRIGGER "source_registry_rss_config_v2_no_delete";

DROP TRIGGER "source_registry_rss_config_v2_update_guard";

DROP TRIGGER "source_registry_rss_config_v3_insert_guard";

DROP TRIGGER "source_registry_rss_config_v3_no_delete";

DROP TRIGGER "source_registry_rss_config_v3_update_guard";

DROP TRIGGER "source_registry_rss_skysports_identity_no_delete";

DROP TRIGGER "source_registry_rss_skysports_identity_no_update";

DROP TRIGGER "source_registry_update_effects";

DROP TRIGGER "source_registry_update_guard";

DROP TRIGGER "x_manual_audit_insert_guard";

DROP TRIGGER "x_manual_audit_no_delete";

DROP TRIGGER "x_manual_audit_no_update";

DROP TRIGGER "x_manual_operation_insert_guard";

DROP TRIGGER "x_manual_operation_no_delete";

DROP TRIGGER "x_manual_operation_no_update";

DROP TRIGGER "x_manual_source_registry_immutable_delete";

DROP TRIGGER "x_manual_source_registry_immutable_update";

DROP TRIGGER "x_manual_submission_insert_guard";

DROP TRIGGER "x_manual_submission_no_delete";

DROP TRIGGER "x_manual_submission_transition_guard";

DROP TRIGGER "x_manual_write_permit_consume_guard";

DROP TRIGGER "x_manual_write_permit_insert_guard";

DROP TRIGGER "x_manual_write_permit_no_delete";

DROP VIEW "authorized_gateway_write_permit_v1";

DROP VIEW "bilingual_lineage_effective_safety_v1";

DROP VIEW "internal_operation_current_v1";

DROP VIEW "rss_automatic_fence_current_v1";

DROP VIEW "rss_automatic_source_binding_current_v1";

DROP VIEW "source_registry_rss_config_current";

DROP VIEW "valid_backup_recovery_point_v1";

ALTER TABLE "source" RENAME TO "source_pre_0017";

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

INSERT INTO source(source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code) SELECT source_id,feed_url,enabled,stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code FROM "source_pre_0017";

DROP TABLE "source_pre_0017";

ALTER TABLE "source_registry_v1" RENAME TO "source_registry_v1_pre_0017";

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

INSERT INTO "source_registry_v1" SELECT * FROM "source_registry_v1_pre_0017";

DROP TABLE "source_registry_v1_pre_0017";

ALTER TABLE "internal_operation_policy" RENAME TO "internal_operation_policy_pre_0017";

CREATE TABLE internal_operation_policy (
  policy_id TEXT PRIMARY KEY,
  owner_process TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  capability_class TEXT NOT NULL CHECK(capability_class IN ('db_mutation','external_attempt','reconcile_readonly','control','backup','restore')),
  phase TEXT NOT NULL CHECK(phase IN ('disabled','backlog','live','paused')),
  egress_class TEXT NOT NULL CHECK(egress_class IN ('none','rss_https','model_https','projection_private','x_official_https','backup_private')),
  required_identity TEXT NOT NULL CHECK(required_identity IN ('none','source','candidate','publication','source_candidate','publication_public')),
  allow_global_stop INTEGER NOT NULL CHECK(allow_global_stop IN (0,1)),
  allow_emergency_stop INTEGER NOT NULL CHECK(allow_emergency_stop IN (0,1)),
  allowed_recovery_state TEXT NOT NULL CHECK(allowed_recovery_state IN ('ready','not_ready','any')),
  source_fence_mode TEXT NOT NULL CHECK(source_fence_mode IN ('not_applicable','must_clear','quarantine_only')),
  deletion_fence_mode TEXT NOT NULL CHECK(deletion_fence_mode IN ('not_applicable','must_clear','reconcile_only')),
  publication_fence_mode TEXT NOT NULL CHECK(publication_fence_mode IN ('not_applicable','must_clear','reconcile_only')),
  UNIQUE(policy_id,owner_process,operation_kind,capability_class)
) STRICT;

INSERT INTO "internal_operation_policy" SELECT * FROM "internal_operation_policy_pre_0017";

DROP TABLE "internal_operation_policy_pre_0017";

ALTER TABLE "internal_operation" RENAME TO "internal_operation_pre_0017";

CREATE TABLE internal_operation (
  operation_id TEXT PRIMARY KEY CHECK(length(CAST(operation_id AS BLOB)) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN (
    'collect','refine','review','publish','reconcile','projection','backfill',
    'source_create','source_update','source_delete','system_producer','phase_control',
    'backup','restore','withdraw'
  )),
  owner_process TEXT NOT NULL CHECK(owner_process IN (
    'x_page_importer','rss_collector','rss_refiner','automatic_reviewer','automatic_publisher',
    'projection_sender','projection_receiver','x_official_adapter','bilingual_refiner',
    'admin_http','admin_telemetry_producer','backup_worker','restore_operator','system_supervisor','reconciler'
  )),
  capability_class TEXT NOT NULL CHECK(capability_class IN ('db_mutation','external_attempt','reconcile_readonly','control','backup','restore')),
  policy_id TEXT NOT NULL REFERENCES internal_operation_policy(policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  authorization_handoff_id TEXT NOT NULL REFERENCES owner_authorization_handoff(handoff_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  control_action TEXT CHECK(control_action IS NULL OR control_action IN (
    'enter_backlog','enter_live','pause','disable','set_global_stop','clear_global_stop',
    'set_emergency_stop','clear_emergency_stop','recovery_begin','recovery_advance',
    'recovery_complete','recovery_abort','writer_epoch_bump','fence_update'
  )),
  state TEXT NOT NULL CHECK(state IN (
    'requested','authorized','attempt_committed','in_flight','succeeded','blocked',
    'reconcile_required','terminal_failed','cancelled'
  )),
  version INTEGER NOT NULL CHECK(version>=1),
  candidate_id TEXT,
  source_id TEXT,
  publication_id TEXT,
  public_id TEXT,
  phase TEXT NOT NULL CHECK(phase IN ('disabled','backlog','live','paused')),
  attempt INTEGER NOT NULL CHECK(attempt>=0),
  budget_reservation_id TEXT,
  egress_class TEXT NOT NULL CHECK(egress_class IN ('none','rss_https','model_https','projection_private','x_official_https','backup_private')),
  model_route_ref TEXT,
  expected_schema_sha256 TEXT NOT NULL CHECK(length(expected_schema_sha256)=64 AND expected_schema_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_release_sha256 TEXT NOT NULL CHECK(length(expected_release_sha256)=64 AND expected_release_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_manifest_sha256 TEXT NOT NULL CHECK(length(expected_manifest_sha256)=64 AND expected_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_config_epoch INTEGER NOT NULL CHECK(source_config_epoch>=1),
  source_safety_epoch INTEGER NOT NULL CHECK(source_safety_epoch>=1),
  authorization_version INTEGER NOT NULL CHECK(authorization_version>=1),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch>=1),
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=1),
  source_stop_epoch INTEGER,
  global_stop_state TEXT NOT NULL CHECK(global_stop_state IN ('clear','stopped','unknown')),
  emergency_stop_state TEXT NOT NULL CHECK(emergency_stop_state IN ('clear','stopped','unknown')),
  recovery_state TEXT NOT NULL CHECK(recovery_state IN ('fenced','restoring','verifying','ready','failed','unknown')),
  deletion_fence_state TEXT NOT NULL CHECK(deletion_fence_state IN ('clear','blocked','unknown')),
  publication_fence_state TEXT NOT NULL CHECK(publication_fence_state IN ('clear','blocked','unknown')),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  expected_control_version INTEGER NOT NULL CHECK(expected_control_version>=1),
  expected_entity_version INTEGER CHECK(expected_entity_version IS NULL OR expected_entity_version>=0),
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  entity_set_json TEXT NOT NULL CHECK(json_valid(entity_set_json) AND json_type(entity_set_json)='array'),
  entity_set_hash TEXT NOT NULL CHECK(length(entity_set_hash)=64 AND entity_set_hash NOT GLOB '*[^0-9a-f]*'),
  required_fence_set_json TEXT NOT NULL CHECK(json_valid(required_fence_set_json) AND json_type(required_fence_set_json)='array'),
  required_fence_set_hash TEXT NOT NULL CHECK(length(required_fence_set_hash)=64 AND required_fence_set_hash NOT GLOB '*[^0-9a-f]*'),
  expected_writer_epoch INTEGER NOT NULL CHECK(expected_writer_epoch>=1),
  result_hash TEXT CHECK(result_hash IS NULL OR (length(result_hash)=64 AND result_hash NOT GLOB '*[^0-9a-f]*')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((egress_class='none')=(budget_reservation_id IS NULL)),
  CHECK((operation_kind='refine' AND egress_class='model_https')=(model_route_ref IS NOT NULL)),
  CHECK((operation_kind='phase_control' OR (operation_kind='restore' AND egress_class='none')
    OR (operation_kind='system_producer' AND owner_process='system_supervisor'))=(control_action IS NOT NULL)),
  CHECK(source_id IS NOT NULL OR source_stop_epoch IS NULL),
  CHECK(state NOT IN ('succeeded','blocked','terminal_failed','cancelled') OR result_hash IS NOT NULL)
) STRICT;

INSERT INTO "internal_operation" SELECT * FROM "internal_operation_pre_0017";

DROP TABLE "internal_operation_pre_0017";

ALTER TABLE "operation_entity_binding" RENAME TO "operation_entity_binding_pre_0017";

CREATE TABLE operation_entity_binding (
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'x_page_capture','x_page_producer_receipt','x_page_source_config','x_page_source_admission','x_page_source_registry','source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
    'publication','published_projection','projection_outbox','projection_receipt','legacy_admin_operation',
    'legacy_audit','internal_control','telemetry_receipt','generic_fence','backup','projection_pointer'
  )),
  entity_id TEXT NOT NULL,
  identity_selector TEXT NOT NULL CHECK(identity_selector IN (
    'source_id','candidate_id','publication_id','public_id','control_singleton','bound_child'
  )),
  expected_entity_version INTEGER CHECK(expected_entity_version IS NULL OR expected_entity_version>=0),
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  entity_set_hash TEXT NOT NULL CHECK(length(entity_set_hash)=64 AND entity_set_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY(operation_id,entity_kind,entity_id)
) WITHOUT ROWID, STRICT;

INSERT INTO "operation_entity_binding" SELECT * FROM "operation_entity_binding_pre_0017";

DROP TABLE "operation_entity_binding_pre_0017";

ALTER TABLE "gateway_write_permit" RENAME TO "gateway_write_permit_pre_0017";

CREATE TABLE gateway_write_permit (
  permit_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN (
    'x_page_capture','x_page_producer_receipt','x_page_source_config','x_page_source_admission','x_page_source_registry','source','ingest_run','candidate','rss_media','machine_draft','review_bundle','review_decision',
    'publication','published_projection','projection_outbox','projection_receipt','legacy_admin_operation',
    'legacy_audit','internal_control','telemetry_receipt','generic_fence','backup','projection_pointer'
  )),
  entity_id TEXT NOT NULL,
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN ('insert','update','delete','activate','consume')),
  expected_entity_version INTEGER,
  expected_entity_hash TEXT NOT NULL CHECK(length(expected_entity_hash)=64 AND expected_entity_hash NOT GLOB '*[^0-9a-f]*'),
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_id,entity_kind,entity_id,mutation_kind),
  CHECK(expected_entity_version IS NULL OR expected_entity_version>=0)
) STRICT;

INSERT INTO "gateway_write_permit" SELECT * FROM "gateway_write_permit_pre_0017";

DROP TABLE "gateway_write_permit_pre_0017";

ALTER TABLE "publication" RENAME TO "publication_pre_0017";

CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY CHECK (length(CAST(publication_id AS BLOB)) BETWEEN 1 AND 256),
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decision(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  bundle_id TEXT NOT NULL UNIQUE REFERENCES review_bundle(bundle_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  public_id TEXT NOT NULL UNIQUE CHECK (
    (length(public_id) = 75 AND substr(public_id,1,11)='public-rss-' AND substr(public_id,12) NOT GLOB '*[^0-9a-f]*')
    OR (length(public_id)=73 AND substr(public_id,1,9)='public-x-' AND substr(public_id,10) NOT GLOB '*[^0-9a-f]*')
  ),
  approved_bundle_hash TEXT NOT NULL CHECK (length(approved_bundle_hash) = 64 AND approved_bundle_hash NOT GLOB '*[^0-9a-f]*'),
  publish_generation INTEGER NOT NULL DEFAULT 1 CHECK (publish_generation = 1),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('queued', 'published', 'reconcile_wait', 'terminal_failed', 'emergency_stopped', 'superseded')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (publication_status <> 'published' OR published_at IS NOT NULL),
  CHECK (publication_status NOT IN ('queued', 'superseded') OR published_at IS NULL)
) STRICT;

INSERT INTO "publication" SELECT * FROM "publication_pre_0017";

DROP TABLE "publication_pre_0017";

INSERT INTO source(source_id,feed_url,source_kind,enabled,stop_epoch,last_reason_code) SELECT source_id,NULL,'x_page',0,source_safety_epoch,'X_PAGE_ADMISSION_REQUIRED' FROM source_registry_v1 WHERE source_id IN(SELECT source_id FROM migration_0017_source);

UPDATE source_registry_v1 SET source_kind='x_page',collection_mode='browser_visible_dom',revision=revision+1,canonical_url_valid=0,normalization_status='pending',dedup_status='pending',identity_status='unknown',relevance_status='unknown',monitorability='unknown',adapter_status='unchecked',adapter_authorization_status='unknown',platform_allowed='unknown',authorization_expires_at=NULL,lifecycle_status='proposed',collection_onboarding_status='validating',enabled=0,identity_sha256=(SELECT identity_sha256 FROM migration_0017_source WHERE source_id=source_registry_v1.source_id),updated_at=(SELECT applied_at FROM migration_0017_manifest) WHERE source_id IN(SELECT source_id FROM migration_0017_source);

INSERT INTO internal_operation_policy VALUES('p-x-page-trusted-import-live','x_page_importer','collect','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-refine-live','bilingual_refiner','refine','external_attempt','live','model_https','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-live','source_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-live','source_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-live','candidate_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-live','source_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-live','candidate_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-refine-store-live','bilingual_refiner','refine','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-store-live','source_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-store-live','source_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-store-live','candidate_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-store-live','source_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-refine-store-live','candidate_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-auto-review-live','automatic_reviewer','review','db_mutation','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-review-live','source_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-review-live','source_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-review-live','candidate_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-review-live','source_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-review-live','candidate_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-auto-publish-live','automatic_publisher','publish','db_mutation','live','none','publication_public',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-publish-live','publication_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-publish-live','publication_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-publish-live','publication_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-publish-live','publication_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-auto-publish-live','publication_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-fence-live','system_supervisor','system_producer','control','live','none','source_candidate',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_control_action_policy VALUES('p-x-page-fence-live','system_supervisor','system_producer','control','fence_update');

INSERT INTO internal_operation_policy VALUES('p-x-page-projection-live','projection_sender','projection','external_attempt','live','projection_private','publication_public',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-projection-live','publication_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-projection-live','publication_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-projection-live','publication_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-projection-live','publication_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-projection-live','publication_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-reconcile-live','reconciler','reconcile','reconcile_readonly','live','projection_private','publication_public',0,0,'ready','must_clear','must_clear','must_clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-reconcile-live','publication_id','deletion','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-reconcile-live','publication_id','rights','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-reconcile-live','publication_id','completeness','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-reconcile-live','publication_id','media','clear');

INSERT INTO internal_required_fence_policy VALUES('p-x-page-reconcile-live','publication_id','publication','clear');

INSERT INTO internal_operation_policy VALUES('p-x-page-source-update-paused','admin_http','source_update','control','paused','none','source',0,0,'ready','must_clear','not_applicable','not_applicable');

INSERT INTO internal_operation_policy VALUES('p-x-page-source-admit-paused','system_supervisor','system_producer','control','paused','none','source',1,0,'ready','not_applicable','not_applicable','not_applicable');

INSERT INTO internal_control_action_policy VALUES('p-x-page-source-admit-paused','system_supervisor','system_producer','control','fence_update');

INSERT INTO gateway_entity_policy VALUES('collect','db_mutation','candidate','insert','candidate_id');
INSERT INTO gateway_entity_policy VALUES('collect','db_mutation','candidate','update','candidate_id');
INSERT INTO gateway_entity_policy VALUES('collect','db_mutation','x_page_capture','insert','bound_child');

INSERT INTO gateway_entity_policy VALUES('collect','db_mutation','x_page_producer_receipt','insert','bound_child');

INSERT INTO gateway_entity_policy VALUES('system_producer','control','x_page_source_admission','insert','bound_child');

INSERT INTO gateway_entity_policy VALUES('system_producer','control','x_page_source_config','update','bound_child');

INSERT INTO gateway_entity_policy VALUES('system_producer','control','x_page_source_registry','update','bound_child');

INSERT INTO gateway_entity_policy VALUES('system_producer','control','source','update','source_id');

CREATE UNIQUE INDEX gateway_write_permit_pending_entity_idx
  ON gateway_write_permit(entity_kind,entity_id,mutation_kind) WHERE consumed_at IS NULL;

CREATE INDEX internal_operation_entity_idx
  ON internal_operation(source_id,candidate_id,publication_id,operation_id);

CREATE INDEX internal_operation_state_owner_idx
  ON internal_operation(state,owner_process,updated_at,operation_id);

CREATE INDEX publication_status_updated_idx
  ON publication(publication_status, updated_at, public_id);

CREATE INDEX source_registry_list_idx ON source_registry_v1(lifecycle_status,enabled,updated_at DESC,source_id);

CREATE TRIGGER admin_operation_no_delete
BEFORE DELETE ON admin_operation
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER admin_operation_no_update
BEFORE UPDATE ON admin_operation
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER audit_event_guard_insert
BEFORE INSERT ON audit_event
WHEN json_extract(NEW.event_json, '$.schemaVersion') IS NOT 'admin-audit-v1'
  OR json_extract(NEW.event_json, '$.eventType') IS NOT NEW.event_type
  OR json_extract(NEW.event_json, '$.operationId') IS NOT NEW.operation_id
  OR json_extract(NEW.event_json, '$.entityType') IS NOT NEW.entity_type
  OR json_extract(NEW.event_json, '$.entityId') IS NOT NEW.entity_id
  OR json_extract(NEW.event_json, '$.actorRef') IS NOT NEW.actor_ref
  OR json_extract(NEW.event_json, '$.occurredAt') IS NOT NEW.created_at
  OR EXISTS (
    SELECT 1
    FROM audit_event AS existing
    WHERE existing.audit_seq = NEW.audit_seq
      OR existing.event_id = NEW.event_id
      OR existing.event_hash = NEW.event_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_INVALID');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_APPEND_ONLY');
END;

CREATE TRIGGER audit_event_predecessor_guard
BEFORE INSERT ON audit_event
WHEN (
  NOT EXISTS (SELECT 1 FROM audit_event) AND
  NEW.previous_event_hash IS NOT NULL
) OR (
  EXISTS (SELECT 1 FROM audit_event) AND
  NEW.previous_event_hash IS NOT (
    SELECT event_hash FROM audit_event ORDER BY audit_seq DESC LIMIT 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_PREDECESSOR_INVALID');
END;

CREATE TRIGGER audit_event_sequence_guard
AFTER INSERT ON audit_event
WHEN NEW.audit_seq <> COALESCE(
  (SELECT MAX(audit_seq) FROM audit_event WHERE audit_seq <> NEW.audit_seq),
  0
) + 1
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENT_SEQUENCE_INVALID');
END;

CREATE TRIGGER backup_recovery_point_insert_guard BEFORE INSERT ON backup_recovery_point
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  WHERE p.entity_kind='backup' AND p.entity_id=NEW.recovery_point_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
    AND op.operation_kind='backup' AND op.state='authorized' AND op.recovery_epoch=NEW.recovery_epoch)
BEGIN SELECT RAISE(ABORT,'BACKUP_OPERATION_REQUIRED'); END;

CREATE TRIGGER backup_recovery_point_no_delete BEFORE DELETE ON backup_recovery_point BEGIN SELECT RAISE(ABORT,'RECOVERY_POINT_IMMUTABLE'); END;

CREATE TRIGGER backup_recovery_point_no_update BEFORE UPDATE ON backup_recovery_point BEGIN SELECT RAISE(ABORT,'RECOVERY_POINT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_active_pointer_insert_guard
BEFORE INSERT ON bilingual_public_projection_active_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NEW.pointer_version <> 1
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND public_id = NEW.public_id AND generation = NEW.generation AND schema_version = NEW.schema_version AND release_sha256 = NEW.release_sha256 AND manifest_sha256 = NEW.manifest_sha256 AND payload_hash = NEW.projection_hash AND ((NEW.status = 'withdrawn' AND status = 'withdrawn') OR (NEW.status = 'active' AND status = 'active')))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_CLOSED'); END;

CREATE TRIGGER bilingual_active_pointer_no_delete
BEFORE DELETE ON bilingual_public_projection_active_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_IMMUTABLE'); END;

CREATE TRIGGER bilingual_active_pointer_transition_guard
BEFORE UPDATE ON bilingual_public_projection_active_v1
WHEN NEW.public_id <> OLD.public_id OR NEW.projection_id = OLD.projection_id
  OR NEW.generation <= OLD.generation OR NEW.projection_hash = OLD.projection_hash
  OR NEW.schema_version <> OLD.schema_version OR NEW.release_sha256 <> OLD.release_sha256 OR NEW.manifest_sha256 <> OLD.manifest_sha256
  OR NEW.pointer_version <> OLD.pointer_version + 1 OR NEW.operation_id = OLD.operation_id
  OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_receiver')
  )
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND public_id = NEW.public_id AND generation = NEW.generation AND schema_version = NEW.schema_version AND release_sha256 = NEW.release_sha256 AND manifest_sha256 = NEW.manifest_sha256 AND payload_hash = NEW.projection_hash AND ((NEW.status = 'withdrawn' AND status = 'withdrawn') OR (NEW.status = 'active' AND status = 'active')))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_ACTIVE_POINTER_CAS'); END;

CREATE TRIGGER bilingual_approval_insert_guard
BEFORE INSERT ON bilingual_approval_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action IN ('approve', 'reject')
    AND link.candidate_id = (SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id AND bundle_hash = NEW.bundle_hash AND state = 'reviewable')
  OR (NEW.decision IN ('approved', 'manual_override') AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.decided_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.decided_at)
  ))
  OR NEW.actor_ref LIKE 'system-%'
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_REVIEW_MANUAL_ONLY'); END;

CREATE TRIGGER bilingual_approval_no_delete
BEFORE DELETE ON bilingual_approval_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_APPROVAL_IMMUTABLE'); END;

CREATE TRIGGER bilingual_approval_no_update
BEFORE UPDATE ON bilingual_approval_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_APPROVAL_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_audit_no_delete BEFORE DELETE ON bilingual_authority_audit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_audit_no_update BEFORE UPDATE ON bilingual_authority_audit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_bridge_marker_insert_guard
BEFORE INSERT ON bilingual_authority_bridge_marker_v1
WHEN NOT EXISTS (
  SELECT 1 FROM quick_launch_authority_permit_v2 p
  JOIN quick_launch_authority_v2 a ON a.capability_id = p.capability_id
  JOIN internal_operation op ON op.operation_id = p.operation_id
  WHERE p.operation_id = NEW.operation_id AND p.action = NEW.action AND p.consumed_at = NEW.created_at
    AND p.authority_receipt_sha256 = NEW.authority_receipt_sha256
    AND a.schema_sha256 = NEW.target_schema_sha256 AND a.authority_receipt_sha256 = NEW.authority_receipt_sha256
    AND op.state = 'authorized' AND op.phase = 'disabled' AND op.egress_class = 'none'
    AND ((NEW.action = 'enable' AND a.state = 'enabled'
          AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id = 'bilingual_auto_refine') = 'enabled'
          AND (SELECT state FROM quick_launch_authority_v2 WHERE capability_id = 'bilingual_manual_mutation') = 'enabled')
      OR (NEW.action = 'close' AND a.state = 'closed'
          AND (SELECT status FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1') = 'enabled'))
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_INVALID'); END;

CREATE TRIGGER bilingual_authority_bridge_marker_no_delete BEFORE DELETE ON bilingual_authority_bridge_marker_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_bridge_marker_update_guard
BEFORE UPDATE ON bilingual_authority_bridge_marker_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.bridge_id <> OLD.bridge_id OR NEW.operation_id <> OLD.operation_id
  OR NEW.action <> OLD.action OR NEW.target_schema_sha256 <> OLD.target_schema_sha256
  OR NEW.authority_receipt_sha256 <> OLD.authority_receipt_sha256 OR NEW.created_at <> OLD.created_at
  OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_BRIDGE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_capability_v1_no_delete
BEFORE DELETE ON bilingual_authority_capability_v1
BEGIN
  SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED');
END;

CREATE TRIGGER bilingual_authority_capability_v1_no_insert
BEFORE INSERT ON bilingual_authority_capability_v1
BEGIN
  SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_FIXED_SET');
END;

CREATE TRIGGER bilingual_authority_permit_insert_guard
BEFORE INSERT ON bilingual_authority_permit_v1
WHEN NOT EXISTS (
  SELECT 1 FROM internal_operation op
  JOIN owner_authorization_handoff h ON h.handoff_id = op.authorization_handoff_id
  JOIN internal_control c ON c.singleton_id = 1
  JOIN bilingual_authority_capability_v1 a ON a.capability_id = 'bilingual-v1'
  WHERE op.operation_id = NEW.operation_id AND op.state = 'authorized'
    AND op.owner_process = 'admin_http' AND op.operation_kind = 'phase_control'
    AND op.capability_class = 'control' AND op.policy_id = 'p-phase-control-disabled'
    AND op.control_action = 'fence_update' AND op.phase = 'disabled' AND op.egress_class = 'none'
    AND op.expected_schema_sha256 = NEW.target_schema_sha256 AND NEW.request_hash = op.request_hash
    AND h.consumed_by_operation_id = op.operation_id
    AND op.updated_at = NEW.created_at AND h.verified_at <= NEW.created_at AND h.expires_at > NEW.created_at
    AND c.phase = 'disabled' AND c.global_stop_state = 'stopped' AND c.emergency_stop_state = 'clear'
    AND c.recovery_state = 'fenced'
    AND op.source_config_epoch = c.source_config_epoch AND op.source_safety_epoch = c.source_safety_epoch
    AND op.authorization_version = c.authorization_version AND op.policy_epoch = c.policy_epoch
    AND op.recovery_epoch = c.recovery_epoch AND op.expected_writer_epoch = c.writer_epoch
    AND a.version = NEW.expected_version
    AND (NEW.target_schema_sha256 = a.schema_sha256 OR EXISTS (
      SELECT 1 FROM bilingual_authority_bridge_marker_v1 m
      WHERE m.operation_id = NEW.operation_id AND m.action = NEW.action
        AND m.target_schema_sha256 = NEW.target_schema_sha256
        AND m.authority_receipt_sha256 = NEW.authority_receipt_sha256
        AND m.created_at = NEW.created_at AND m.consumed_at IS NULL
    ))
    AND ((NEW.action = 'enable' AND a.status = 'closed') OR (NEW.action = 'close' AND a.status = 'enabled'))
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_INVALID'); END;

CREATE TRIGGER bilingual_authority_permit_no_delete BEFORE DELETE ON bilingual_authority_permit_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_authority_permit_update_guard
BEFORE UPDATE ON bilingual_authority_permit_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id <> OLD.permit_id OR NEW.operation_id <> OLD.operation_id
  OR NEW.action <> OLD.action OR NEW.expected_version <> OLD.expected_version OR NEW.target_schema_sha256 <> OLD.target_schema_sha256
  OR NEW.extension_sha256 <> OLD.extension_sha256 OR NEW.one_time_nonce <> OLD.one_time_nonce
  OR NEW.request_hash <> OLD.request_hash OR NEW.authority_receipt_sha256 <> OLD.authority_receipt_sha256
  OR NEW.created_at <> OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_PERMIT_IMMUTABLE'); END;

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

CREATE TRIGGER bilingual_authority_transition_consume
AFTER UPDATE ON bilingual_authority_capability_v1
BEGIN
  UPDATE bilingual_authority_permit_v1 SET consumed_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id AND expected_version = OLD.version AND consumed_at IS NULL;
  UPDATE bilingual_authority_bridge_marker_v1 SET consumed_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id
    AND action = CASE NEW.status WHEN 'enabled' THEN 'enable' ELSE 'close' END AND consumed_at IS NULL;
  INSERT INTO bilingual_authority_audit_v1 VALUES (
    'bilingual-authority-v1-' || NEW.version, OLD.status, NEW.status, OLD.version, NEW.version,
    NEW.updated_by_operation_id,
    (SELECT permit_id FROM bilingual_authority_permit_v1 WHERE expected_version = OLD.version),
    NEW.authority_receipt_sha256, NEW.updated_at
  );
  UPDATE internal_operation SET state = 'succeeded', version = version + 1,
    result_hash = NEW.authority_receipt_sha256, reason_code = 'AUTHORITY_TRANSITION_COMMITTED', updated_at = NEW.updated_at
  WHERE operation_id = NEW.updated_by_operation_id AND state = 'authorized';
  INSERT INTO internal_operation_audit(event_id, operation_id, event_type, actor_ref, event_json, previous_event_hash, event_hash, created_at)
  VALUES ('bilingual-authority-v1-' || NEW.version, NEW.updated_by_operation_id, 'operation_succeeded', 'admin_http',
    json_object('capabilityId', 'bilingual-v1', 'state', NEW.status, 'version', NEW.version),
    (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1),
    (SELECT request_hash FROM bilingual_authority_permit_v1 WHERE expected_version = OLD.version), NEW.updated_at);
END;

CREATE TRIGGER bilingual_authority_transition_guard
BEFORE UPDATE ON bilingual_authority_capability_v1
WHEN NEW.capability_id <> OLD.capability_id OR NEW.schema_sha256 <> OLD.schema_sha256 OR NEW.version <> OLD.version + 1
  OR NOT ((OLD.status = 'closed' AND NEW.status = 'enabled' AND OLD.enabled = 0 AND NEW.enabled = 1
            AND NEW.reason_code = 'READY' AND NEW.extension_sha256 IS NOT NULL)
       OR (OLD.status = 'enabled' AND NEW.status = 'closed' AND OLD.enabled = 1 AND NEW.enabled = 0
            AND NEW.reason_code = 'AUTHORITY_EXTENSION_REQUIRED'))
  OR NEW.updated_by_operation_id IS NULL OR NEW.authority_receipt_sha256 IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_authority_permit_v1 p
    WHERE p.operation_id = NEW.updated_by_operation_id AND p.expected_version = OLD.version
      AND p.consumed_at IS NULL AND p.created_at = NEW.updated_at
      AND p.extension_sha256 = NEW.extension_sha256
      AND p.authority_receipt_sha256 = NEW.authority_receipt_sha256
      AND ((p.action = 'enable' AND NEW.status = 'enabled') OR (p.action = 'close' AND NEW.status = 'closed'))
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_bundle_insert_guard
BEFORE INSERT ON bilingual_bundle_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.semantic_action = 'create_bundle' AND link.parent_operation_id IS NULL AND link.language IS NULL
    AND op.state = 'succeeded' AND op.owner_process = 'bilingual_refiner'
)
  OR NEW.zh_slot_id = NEW.en_slot_id
  OR NOT EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE slot_id = NEW.zh_slot_id AND candidate_id = NEW.candidate_id AND language = 'zh-CN' AND revision = NEW.zh_slot_revision AND state = 'complete' AND draft_hash = NEW.zh_draft_hash AND prompt_schema_version = NEW.prompt_schema_version AND prompt_sha256 = NEW.prompt_sha256 AND model_route_receipt_hash = NEW.zh_model_route_receipt_hash)
  OR NOT EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE slot_id = NEW.en_slot_id AND candidate_id = NEW.candidate_id AND language = 'en' AND revision = NEW.en_slot_revision AND state = 'complete' AND draft_hash = NEW.en_draft_hash AND prompt_schema_version = NEW.prompt_schema_version AND prompt_sha256 = NEW.prompt_sha256 AND model_route_receipt_hash = NEW.en_model_route_receipt_hash)
  OR EXISTS (SELECT 1 FROM bilingual_language_slot_v1 WHERE candidate_id = NEW.candidate_id AND language NOT IN ('zh-CN', 'en'))
  OR NOT EXISTS (SELECT 1 FROM bilingual_candidate_lineage_v1 WHERE candidate_id = NEW.candidate_id AND source_revision = NEW.source_revision AND input_content_hash = NEW.input_content_hash AND source_fact_set_hash = NEW.source_fact_set_hash AND source_release_hash = NEW.source_release_hash AND copy_risk_status = 'screen_passed' AND rights_status = 'clear' AND deletion_status = 'clear' AND media_status IN ('none', 'allowed'))
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    WHERE safety.candidate_id = NEW.candidate_id AND safety.source_revision = NEW.source_revision
      AND safety.input_content_hash = NEW.input_content_hash AND safety.action = 'clear'
      AND safety.copy_risk_status = 'screen_passed' AND safety.rights_status = 'clear'
      AND safety.deletion_status = 'clear' AND safety.media_status IN ('none', 'allowed')
      AND safety.expires_at > NEW.created_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.created_at)
      AND json_extract(NEW.payload_json, '$.safetyAuthority.decisionId') = safety.decision_id
      AND json_extract(NEW.payload_json, '$.safetyAuthority.decisionSeq') = safety.decision_seq
      AND json_extract(NEW.payload_json, '$.safetyAuthority.resourceHash') = safety.resource_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.requestHash') = safety.request_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.authorityContextHash') = safety.authority_context_hash
      AND json_extract(NEW.payload_json, '$.safetyAuthority.expiresAt') = safety.expires_at
  )
  OR EXISTS (SELECT 1 FROM json_tree(NEW.payload_json) WHERE key IN ('sourceExcerpt', 'rawSource', 'sourceBody', 'rawBody', 'prompt', 'modelResponse', 'privateRouteReceipt'))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_GATE_BLOCKED'); END;

CREATE TRIGGER bilingual_bundle_no_delete
BEFORE DELETE ON bilingual_bundle_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_bundle_no_update
BEFORE UPDATE ON bilingual_bundle_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_BUNDLE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_draft_insert_guard
BEFORE INSERT ON bilingual_language_slot_draft_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = (SELECT operation_id FROM bilingual_model_receipt_v1 WHERE receipt_id = NEW.model_receipt_id)
    AND link.candidate_id = NEW.candidate_id AND link.language = NEW.language
    AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND op.state = 'succeeded'
)
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_model_receipt_v1 receipt
    JOIN internal_external_attempt attempt ON attempt.attempt_id = receipt.attempt_id
    WHERE receipt.receipt_id = NEW.model_receipt_id AND receipt.attempt_id = NEW.attempt_id
      AND receipt.slot_id = NEW.slot_id AND receipt.candidate_id = NEW.candidate_id AND receipt.language = NEW.language
      AND receipt.attempt_state = 'response_committed' AND attempt.outcome = 'succeeded'
  )
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json) WHERE key NOT IN ('schemaVersion', 'language', 'title', 'summary', 'lead', 'body', 'keyPoints', 'contentHash'))
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json, '$.body') WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 12000)
  OR EXISTS (SELECT 1 FROM json_each(NEW.output_json, '$.keyPoints') WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 240)
  OR json_type(NEW.output_json, '$.sourceExcerpt') IS NOT NULL
  OR json_type(NEW.output_json, '$.rawSource') IS NOT NULL
  OR json_type(NEW.output_json, '$.sourceBody') IS NOT NULL
  OR json_type(NEW.output_json, '$.rawBody') IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_CONTRACT_INVALID'); END;

CREATE TRIGGER bilingual_draft_no_delete
BEFORE DELETE ON bilingual_language_slot_draft_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_draft_no_update
BEFORE UPDATE ON bilingual_language_slot_draft_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_DRAFT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_lineage_insert_guard
BEFORE INSERT ON bilingual_candidate_lineage_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.semantic_action = 'create_lineage' AND op.state = 'attempt_committed'
) OR NEW.copy_risk_status <> 'unknown' OR NEW.rights_status <> 'unknown'
  OR NEW.deletion_status <> 'unknown' OR NEW.media_status <> 'unknown'
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_lineage_no_delete
BEFORE DELETE ON bilingual_candidate_lineage_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_LINEAGE_IMMUTABLE'); END;

CREATE TRIGGER bilingual_lineage_safety_decision_apply
AFTER INSERT ON bilingual_lineage_safety_decision_v1
BEGIN
  UPDATE gateway_write_permit SET consumed_at = NEW.decided_at
  WHERE operation_id = NEW.operation_id AND entity_kind = 'candidate' AND entity_id = NEW.candidate_id
    AND mutation_kind = 'update' AND consumed_at IS NULL;
  UPDATE bilingual_candidate_lineage_v1
  SET copy_risk_status = NEW.copy_risk_status, rights_status = NEW.rights_status,
      deletion_status = NEW.deletion_status, media_status = NEW.media_status,
      operation_id = NEW.operation_id, updated_at = NEW.decided_at
  WHERE candidate_id = NEW.candidate_id AND source_revision = NEW.source_revision
    AND input_content_hash = NEW.input_content_hash;
END;

CREATE TRIGGER bilingual_lineage_safety_decision_insert_guard
BEFORE INSERT ON bilingual_lineage_safety_decision_v1
WHEN NOT EXISTS (
    SELECT 1 FROM bilingual_authority_capability_v1
    WHERE capability_id = 'bilingual-v1' AND enabled = 1 AND status = 'enabled'
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_authority_bridge_marker_v1 marker
    WHERE marker.action = 'enable' AND marker.consumed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bilingual_authority_bridge_marker_v1 later
        WHERE later.created_at > marker.created_at AND later.action = 'close' AND later.consumed_at IS NOT NULL
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_candidate_lineage_v1 lineage
    JOIN pending_review_candidate candidate ON candidate.candidate_id = lineage.candidate_id
    JOIN source_registry_v1 registry ON registry.source_id = lineage.source_id
    JOIN source_registry_rss_config_v1 config ON config.source_id = lineage.source_id
    JOIN internal_control control ON control.singleton_id = 1
    WHERE lineage.candidate_id = NEW.candidate_id AND lineage.source_id = NEW.source_id
      AND lineage.source_revision = NEW.source_revision AND lineage.input_content_hash = NEW.input_content_hash
      AND candidate.source_id = NEW.source_id AND candidate.source_revision = NEW.source_revision
      AND candidate.source_payload_hash = NEW.input_content_hash
      AND registry.revision = NEW.source_registry_revision AND registry.identity_sha256 = NEW.source_identity_sha256
      AND registry.source_config_epoch = NEW.source_config_epoch AND registry.source_safety_epoch = NEW.source_safety_epoch
      AND registry.authorization_version = NEW.authorization_version AND registry.policy_epoch = NEW.policy_epoch
      AND registry.recovery_epoch = NEW.recovery_epoch AND registry.authorization_expires_at IS NEW.source_authorization_expires_at
      AND registry.enabled = 1 AND registry.lifecycle_status = 'active' AND registry.source_kind = 'rss' AND registry.collection_mode = 'rss'
      AND registry.normalization_status = 'valid' AND registry.dedup_status IN ('unique', 'linked_existing')
      AND registry.adapter_status = 'ready'
      AND registry.adapter_authorization_status = 'valid' AND registry.platform_allowed = 'allowed' AND registry.source_stop_status = 'clear'
      AND (registry.authorization_expires_at IS NULL OR registry.authorization_expires_at > NEW.decided_at)
      AND config.source_revision = NEW.source_config_revision
      AND config.authorization_receipt_sha256 = NEW.source_authorization_receipt_sha256
      AND config.source_policy_sha256 = NEW.source_policy_sha256
      AND control.source_config_epoch = NEW.control_source_config_epoch AND control.source_safety_epoch = NEW.control_source_safety_epoch
      AND control.authorization_version = NEW.control_authorization_version AND control.policy_epoch = NEW.control_policy_epoch
      AND control.recovery_epoch = NEW.control_recovery_epoch AND control.writer_epoch = NEW.writer_epoch
  )
  OR NOT EXISTS (
    SELECT 1 FROM internal_operation op
    JOIN bilingual_operation_link_v1 link ON link.operation_id = op.operation_id
    JOIN operation_entity_binding source_binding ON source_binding.operation_id = op.operation_id
      AND source_binding.entity_kind = 'source' AND source_binding.entity_id = NEW.source_id
      AND source_binding.identity_selector = 'source_id'
    JOIN operation_entity_binding candidate_binding ON candidate_binding.operation_id = op.operation_id
      AND candidate_binding.entity_kind = 'candidate' AND candidate_binding.entity_id = NEW.candidate_id
      AND candidate_binding.identity_selector = 'candidate_id'
    JOIN gateway_write_permit permit ON permit.operation_id = op.operation_id
      AND permit.entity_kind = 'candidate' AND permit.entity_id = NEW.candidate_id
      AND permit.mutation_kind = 'update' AND permit.expected_entity_version = NEW.source_revision
      AND permit.expected_entity_hash = NEW.input_content_hash AND permit.consumed_at IS NULL
    WHERE op.operation_id = NEW.operation_id AND op.state = 'authorized'
      AND op.owner_process = 'admin_http' AND op.operation_kind = 'review'
      AND op.capability_class = 'db_mutation' AND op.egress_class = 'none'
      AND op.policy_id = 'p-review-admin-' || op.phase
      AND op.candidate_id = NEW.candidate_id AND op.source_id = NEW.source_id
      AND op.expected_entity_version = NEW.source_revision AND op.expected_entity_hash = NEW.input_content_hash
      AND op.request_hash = NEW.request_hash
      AND link.candidate_id = NEW.candidate_id AND link.semantic_action = 'decide_safety'
      AND link.request_hash = NEW.request_hash
  )
  OR (NEW.supersedes_decision_id IS NULL AND EXISTS (
      SELECT 1 FROM bilingual_lineage_safety_decision_v1 WHERE candidate_id = NEW.candidate_id
    ))
  OR (NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bilingual_lineage_safety_decision_v1 previous
      WHERE previous.decision_id = NEW.supersedes_decision_id AND previous.candidate_id = NEW.candidate_id
        AND previous.decision_seq = NEW.decision_seq - 1
        AND NOT EXISTS (
          SELECT 1 FROM bilingual_lineage_safety_decision_v1 later
          WHERE later.candidate_id = previous.candidate_id AND later.decision_seq > previous.decision_seq
        )
    ))
  OR (NEW.decision_seq <> 1 AND NEW.supersedes_decision_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_INVALID'); END;

CREATE TRIGGER bilingual_lineage_safety_decision_no_delete
BEFORE DELETE ON bilingual_lineage_safety_decision_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_lineage_safety_decision_no_update
BEFORE UPDATE ON bilingual_lineage_safety_decision_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SAFETY_DECISION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_lineage_transition_guard
BEFORE UPDATE ON bilingual_candidate_lineage_v1
WHEN NEW.candidate_id <> OLD.candidate_id OR NEW.public_id <> OLD.public_id OR NEW.source_id <> OLD.source_id
  OR NEW.operation_id = OLD.operation_id OR NEW.created_at <> OLD.created_at OR NEW.updated_at <= OLD.updated_at
  OR NOT (
    (NEW.source_revision = OLD.source_revision + 1
      AND (NEW.input_content_hash <> OLD.input_content_hash OR NEW.source_fact_set_hash <> OLD.source_fact_set_hash OR NEW.source_release_hash <> OLD.source_release_hash)
      AND NEW.copy_risk_status = 'unknown' AND NEW.rights_status = 'unknown'
      AND NEW.deletion_status = 'unknown' AND NEW.media_status = 'unknown'
      AND EXISTS (
        SELECT 1 FROM bilingual_operation_link_v1 link
        JOIN internal_operation op ON op.operation_id = link.operation_id
        WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
          AND link.semantic_action = 'refresh_lineage' AND op.state = 'authorized'
          AND op.owner_process = 'bilingual_refiner'
      ))
    OR
    (NEW.source_revision = OLD.source_revision
      AND NEW.input_content_hash = OLD.input_content_hash
      AND NEW.source_fact_set_hash = OLD.source_fact_set_hash
      AND NEW.source_release_hash = OLD.source_release_hash
      AND EXISTS (
        SELECT 1 FROM bilingual_lineage_safety_decision_v1 decision
        JOIN bilingual_operation_link_v1 link ON link.operation_id = decision.operation_id
        JOIN internal_operation op ON op.operation_id = decision.operation_id
        WHERE decision.operation_id = NEW.operation_id AND decision.candidate_id = NEW.candidate_id
          AND decision.source_id = NEW.source_id AND decision.source_revision = NEW.source_revision
          AND decision.input_content_hash = NEW.input_content_hash
          AND decision.copy_risk_status = NEW.copy_risk_status AND decision.rights_status = NEW.rights_status
          AND decision.deletion_status = NEW.deletion_status AND decision.media_status = NEW.media_status
          AND decision.decided_at = NEW.updated_at
          AND link.candidate_id = NEW.candidate_id AND link.semantic_action = 'decide_safety'
          AND op.state = 'authorized' AND op.owner_process = 'admin_http'
      ))
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_LINEAGE_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_operation_link_insert_guard
BEFORE INSERT ON bilingual_operation_link_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM internal_operation op
  WHERE op.operation_id = NEW.operation_id AND op.state IN ('requested', 'authorized', 'attempt_committed')
    AND op.operation_kind IN ('refine', 'review', 'publish', 'projection', 'backfill', 'withdraw')
    AND op.owner_process NOT IN ('automatic_reviewer', 'automatic_publisher')
)
  OR NOT EXISTS (SELECT 1 FROM internal_operation op WHERE op.operation_id = NEW.operation_id AND op.request_hash = NEW.request_hash)
  OR (NEW.semantic_action IN ('create_lineage', 'refresh_lineage', 'refine_both', 'refine_language', 'retry_language', 'rerun_language', 'create_bundle')
    AND NOT EXISTS (
      SELECT 1 FROM internal_operation op
      WHERE op.operation_id = NEW.operation_id AND op.operation_kind = 'refine'
        AND op.owner_process = 'bilingual_refiner' AND op.capability_class = 'external_attempt'
        AND op.state = 'attempt_committed' AND op.attempt = NEW.attempt_number
    ))
  OR NEW.parent_operation_id = NEW.operation_id
  OR (NEW.semantic_action = 'refine_both' AND EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 child
    WHERE child.operation_id = NEW.operation_id AND child.parent_operation_id IS NOT NULL
      AND child.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
  ))
  OR (NEW.semantic_action = 'refine_both' AND (
    (NEW.attempt_number = 1 AND EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 prior
      WHERE prior.candidate_id = NEW.candidate_id AND prior.semantic_action = 'refine_both'
    ))
    OR (NEW.attempt_number > 1 AND NOT EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 prior
      JOIN internal_operation prior_op ON prior_op.operation_id = prior.operation_id
      JOIN internal_operation current_op ON current_op.operation_id = NEW.operation_id
      JOIN bilingual_operation_link_v1 prior_zh ON prior_zh.operation_id = prior.operation_id
      WHERE prior.candidate_id = NEW.candidate_id AND prior.semantic_action = 'refine_both'
        AND prior.parent_operation_id IS NULL AND prior.language IS NULL
        AND prior.attempt_number = NEW.attempt_number - 1
        AND prior_op.state IN ('succeeded', 'terminal_failed')
        AND prior_zh.candidate_id = prior.candidate_id AND prior_zh.parent_operation_id IS NULL
        AND prior_zh.language = 'zh-CN' AND prior_zh.attempt_number = prior.attempt_number
        AND prior_zh.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
        AND prior_op.source_id = current_op.source_id
        AND prior_op.candidate_id = current_op.candidate_id
        AND prior_op.expected_entity_version = current_op.expected_entity_version
        AND prior_op.expected_entity_hash = current_op.expected_entity_hash
    ))
  ))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND (
    (NEW.attempt_number = 1 AND NEW.semantic_action <> 'refine_language')
    OR (NEW.attempt_number > 1 AND (
      NEW.semantic_action NOT IN ('retry_language', 'rerun_language')
      OR NOT EXISTS (
        SELECT 1 FROM bilingual_operation_link_v1 prior_language
        JOIN internal_operation prior_op ON prior_op.operation_id = prior_language.operation_id
        JOIN internal_operation current_op ON current_op.operation_id = NEW.operation_id
        WHERE prior_language.candidate_id = NEW.candidate_id
          AND prior_language.language = NEW.language
          AND prior_language.attempt_number = NEW.attempt_number - 1
          AND prior_language.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
          AND prior_op.state IN ('succeeded', 'terminal_failed', 'blocked')
          AND prior_op.candidate_id = current_op.candidate_id
          AND prior_op.source_id = current_op.source_id
          AND prior_op.expected_entity_version = current_op.expected_entity_version
          AND prior_op.expected_entity_hash = current_op.expected_entity_hash
      )
    ))
  ))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.parent_operation_id IS NULL
    AND NOT (NEW.language = 'zh-CN' AND EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 carrier
      WHERE carrier.operation_id = NEW.operation_id AND carrier.parent_operation_id IS NULL
        AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
        AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number = NEW.attempt_number
    )))
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.language = 'zh-CN' AND NEW.parent_operation_id IS NOT NULL)
  OR (NEW.semantic_action IN ('refine_language', 'retry_language', 'rerun_language') AND NEW.parent_operation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bilingual_operation_link_v1 carrier
      JOIN internal_operation carrier_op ON carrier_op.operation_id = carrier.operation_id
      JOIN internal_operation child_op ON child_op.operation_id = NEW.operation_id
      JOIN bilingual_operation_link_v1 zh_link ON zh_link.operation_id = carrier.operation_id
      WHERE NEW.language = 'en' AND carrier.operation_id = NEW.parent_operation_id AND carrier.parent_operation_id IS NULL
        AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
        AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number <= NEW.attempt_number
        AND zh_link.candidate_id = carrier.candidate_id AND zh_link.parent_operation_id IS NULL
        AND zh_link.language = 'zh-CN' AND zh_link.attempt_number = carrier.attempt_number
        AND zh_link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
        AND (carrier_op.state = 'succeeded' OR (carrier_op.state = 'attempt_committed' AND carrier.attempt_number = NEW.attempt_number))
        AND carrier_op.candidate_id = child_op.candidate_id
        AND carrier_op.source_id = child_op.source_id
        AND carrier_op.expected_entity_version = child_op.expected_entity_version
        AND carrier_op.expected_entity_hash = child_op.expected_entity_hash
        AND NOT EXISTS (SELECT 1 FROM bilingual_operation_link_v1 role_conflict
          WHERE role_conflict.operation_id = NEW.operation_id AND role_conflict.semantic_action = 'refine_both')
        AND NOT EXISTS (
          SELECT 1 FROM bilingual_operation_link_v1 later
          JOIN internal_operation later_op ON later_op.operation_id = later.operation_id
          WHERE later.candidate_id = carrier.candidate_id AND later.semantic_action = 'refine_both'
            AND later.parent_operation_id IS NULL AND later.language IS NULL
            AND later.attempt_number > carrier.attempt_number AND later_op.state = 'succeeded'
        )
    ))
  OR (NEW.semantic_action = 'create_bundle' AND NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 carrier
    WHERE carrier.operation_id = NEW.operation_id AND carrier.parent_operation_id IS NULL
      AND carrier.candidate_id = NEW.candidate_id AND carrier.language IS NULL
      AND carrier.semantic_action = 'refine_both' AND carrier.attempt_number = NEW.attempt_number
  ))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_operation_link_no_delete
BEFORE DELETE ON bilingual_operation_link_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OPERATION_LINK_IMMUTABLE'); END;

CREATE TRIGGER bilingual_operation_link_no_update
BEFORE UPDATE ON bilingual_operation_link_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OPERATION_LINK_IMMUTABLE'); END;

CREATE TRIGGER bilingual_outbox_insert_guard
BEFORE INSERT ON bilingual_publication_outbox_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'enqueue_delivery'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id WHERE p.publication_id=NEW.publication_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id AND status IN ('published', 'withdrawn'))
  OR NOT EXISTS (SELECT 1 FROM bilingual_public_projection_v1 WHERE projection_id = NEW.projection_id AND generation = NEW.generation AND payload_hash = NEW.generation_hash)
  OR NEW.state <> 'pending' OR NEW.version <> 1 OR NEW.attempt_count <> 0
  OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.reconcile_consumed_at IS NOT NULL
  OR NEW.last_reason_code IS NOT NULL OR NEW.updated_at <> NEW.created_at
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_GATE_BLOCKED'); END;

CREATE TRIGGER bilingual_outbox_no_delete
BEFORE DELETE ON bilingual_publication_outbox_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_IMMUTABLE'); END;

CREATE TRIGGER bilingual_outbox_transition_guard
BEFORE UPDATE ON bilingual_publication_outbox_v1
WHEN NEW.delivery_id <> OLD.delivery_id OR NEW.publication_id <> OLD.publication_id OR NEW.projection_id <> OLD.projection_id
  OR NEW.generation <> OLD.generation OR NEW.generation_hash <> OLD.generation_hash
  OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.reconcile_key <> OLD.reconcile_key
  OR NEW.max_attempts <> OLD.max_attempts OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action IN ('enqueue_delivery', 'reconcile')
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id WHERE p.publication_id=NEW.publication_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_sender', 'projection_receiver', 'reconciler')
  )
  OR NOT (
    (OLD.state = 'pending' AND NEW.state = 'leased' AND NEW.attempt_count = OLD.attempt_count + 1
      AND NEW.lease_token IS NOT NULL AND NEW.lease_expires_at > NEW.updated_at AND NEW.last_reason_code IS NULL
      AND NEW.reconcile_consumed_at IS OLD.reconcile_consumed_at)
    OR (OLD.state = 'pending' AND NEW.state = 'cancelled' AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NOT NULL)
    OR (OLD.state = 'leased' AND NEW.state = 'succeeded' AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NULL)
    OR (OLD.state = 'leased' AND NEW.state IN ('reconcile_required', 'failed') AND NEW.attempt_count = OLD.attempt_count
      AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_reason_code IS NOT NULL)
    OR (OLD.state = 'leased' AND NEW.state = 'pending' AND NEW.updated_at >= OLD.lease_expires_at
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND NEW.last_reason_code IS NOT NULL AND NEW.operation_id <> OLD.operation_id)
    OR (OLD.state = 'reconcile_required' AND NEW.state IN ('succeeded', 'failed', 'cancelled')
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND OLD.reconcile_consumed_at IS NULL AND NEW.reconcile_consumed_at = NEW.updated_at
      AND NEW.operation_id <> OLD.operation_id
      AND ((NEW.state = 'succeeded' AND NEW.last_reason_code IS NULL) OR (NEW.state <> 'succeeded' AND NEW.last_reason_code IS NOT NULL)))
    OR (OLD.state = 'failed' AND NEW.state = 'pending' AND OLD.attempt_count < OLD.max_attempts
      AND NEW.attempt_count = OLD.attempt_count AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
      AND OLD.reconcile_consumed_at IS NULL AND NEW.reconcile_consumed_at IS NULL AND NEW.last_reason_code IS NULL
      AND NEW.operation_id <> OLD.operation_id)
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_OUTBOX_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_projection_insert_guard
BEFORE INSERT ON bilingual_public_projection_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'create_projection'
    AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id = b.bundle_id WHERE p.publication_id = NEW.publication_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id AND public_id = NEW.public_id AND status IN ('published', 'withdrawn'))
  OR EXISTS (SELECT 1 FROM json_tree(NEW.payload_json) WHERE key IN ('sourceExcerpt', 'rawSource', 'sourceBody', 'rawBody', 'prompt', 'modelResponse', 'privateRouteReceipt'))
  OR json_extract(NEW.payload_json, '$.schemaVersion') <> 'public-read-bilingual-v2'
  OR NEW.version <> 1 OR NEW.updated_at <> NEW.created_at
  OR NEW.status <> CASE (SELECT status FROM bilingual_publication_v1 WHERE publication_id = NEW.publication_id)
      WHEN 'published' THEN 'staged' ELSE 'withdrawn' END
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_GATE_BLOCKED'); END;

CREATE TRIGGER bilingual_projection_no_delete
BEFORE DELETE ON bilingual_public_projection_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_projection_transition_guard
BEFORE UPDATE ON bilingual_public_projection_v1
WHEN NEW.projection_id <> OLD.projection_id OR NEW.publication_id <> OLD.publication_id OR NEW.public_id <> OLD.public_id
  OR NEW.generation_id <> OLD.generation_id OR NEW.generation <> OLD.generation OR NEW.schema_version <> OLD.schema_version
  OR NEW.payload_json <> OLD.payload_json OR NEW.payload_hash <> OLD.payload_hash OR NEW.signature <> OLD.signature
  OR NEW.release_sha256 <> OLD.release_sha256 OR NEW.manifest_sha256 <> OLD.manifest_sha256
  OR NEW.version <> OLD.version + 1 OR NEW.operation_id = OLD.operation_id OR NEW.created_at <> OLD.created_at
  OR NEW.updated_at <= OLD.updated_at
  OR NOT ((OLD.status = 'staged' AND NEW.status IN ('active', 'invalid', 'superseded'))
      OR (OLD.status = 'active' AND NEW.status IN ('superseded', 'withdrawn', 'invalid')))
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.semantic_action = 'activate_projection'
      AND link.candidate_id = (SELECT b.candidate_id FROM bilingual_bundle_v1 b JOIN bilingual_publication_v1 p ON p.bundle_id=b.bundle_id JOIN bilingual_public_projection_v1 projection ON projection.publication_id=p.publication_id WHERE projection.projection_id=NEW.projection_id)
      AND op.state = 'authorized' AND op.owner_process IN ('admin_http', 'projection_receiver')
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PROJECTION_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_publication_insert_guard
BEFORE INSERT ON bilingual_publication_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id
    AND link.semantic_action = CASE NEW.change_kind WHEN 'initial' THEN 'publish' WHEN 'correction' THEN 'correct' ELSE 'withdraw' END
    AND link.candidate_id = (SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id = NEW.bundle_id)
    AND op.state = 'authorized' AND op.owner_process = 'admin_http'
)
  OR NOT EXISTS (SELECT 1 FROM bilingual_approval_v1 WHERE approval_id = NEW.approval_id AND bundle_id = NEW.bundle_id AND bundle_hash = NEW.bundle_hash AND decision IN ('approved', 'manual_override'))
  OR EXISTS (SELECT 1 FROM bilingual_approval_v1 a WHERE a.bundle_id = NEW.bundle_id AND a.decision = 'superseded')
  OR (NEW.change_kind <> 'withdrawal' AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.created_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.created_at)
  ))
  OR NEW.status <> CASE NEW.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END
  OR NEW.published_at IS NOT NULL OR NEW.updated_at <> NEW.created_at
  OR (NEW.change_kind = 'initial' AND (NEW.revision <> 1 OR NEW.supersedes_publication_id IS NOT NULL))
  OR (NEW.change_kind IN ('correction', 'withdrawal') AND NOT EXISTS (
    SELECT 1 FROM bilingual_publication_v1 previous
    WHERE previous.publication_id = NEW.supersedes_publication_id AND previous.public_id = NEW.public_id
      AND previous.status = 'published' AND NEW.revision = previous.revision + 1
      AND NOT EXISTS (SELECT 1 FROM bilingual_publication_v1 newer WHERE newer.public_id = previous.public_id AND newer.revision > previous.revision)
      AND ((NEW.change_kind = 'correction' AND (NEW.bundle_id <> previous.bundle_id OR NEW.bundle_hash <> previous.bundle_hash))
        OR (NEW.change_kind = 'withdrawal' AND NEW.bundle_id = previous.bundle_id AND NEW.bundle_hash = previous.bundle_hash
          AND NEW.approval_id = previous.approval_id AND NEW.approval_hash = previous.approval_hash))
  ))
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_MANUAL_ONLY'); END;

CREATE TRIGGER bilingual_publication_no_delete
BEFORE DELETE ON bilingual_publication_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_IMMUTABLE'); END;

CREATE TRIGGER bilingual_publication_transition_guard
BEFORE UPDATE ON bilingual_publication_v1
WHEN NEW.publication_id <> OLD.publication_id OR NEW.public_id <> OLD.public_id OR NEW.revision <> OLD.revision
  OR NEW.change_kind <> OLD.change_kind OR NEW.supersedes_publication_id IS NOT OLD.supersedes_publication_id
  OR NEW.bundle_id <> OLD.bundle_id OR NEW.bundle_hash <> OLD.bundle_hash OR NEW.approval_id <> OLD.approval_id
  OR NEW.approval_hash <> OLD.approval_hash OR NEW.payload_hash <> OLD.payload_hash OR NEW.reason_code IS NOT OLD.reason_code
  OR NEW.created_at <> OLD.created_at OR NEW.updated_at <= OLD.updated_at
  OR (NEW.change_kind <> 'withdrawal' AND NEW.status IN ('publishing', 'published') AND NOT EXISTS (
    SELECT 1 FROM bilingual_lineage_effective_safety_v1 safety
    JOIN bilingual_bundle_v1 bundle ON bundle.candidate_id = safety.candidate_id
    WHERE bundle.bundle_id = NEW.bundle_id AND safety.source_revision = bundle.source_revision
      AND safety.input_content_hash = bundle.input_content_hash AND safety.action = 'clear'
      AND safety.expires_at > NEW.updated_at
      AND (safety.source_authorization_expires_at IS NULL OR safety.source_authorization_expires_at > NEW.updated_at)
  ))
  OR (NEW.operation_id <> OLD.operation_id AND NOT (OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END))
  OR (NEW.operation_id = OLD.operation_id AND OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END)
  OR (NEW.published_at IS NOT OLD.published_at AND NOT (OLD.published_at IS NULL AND NEW.status = 'published' AND NEW.published_at IS NOT NULL))
  OR NOT ((OLD.status = 'queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'publishing' AND NEW.status IN ('published', 'withdrawn', 'reconcile_required', 'failed'))
      OR (OLD.status = 'reconcile_required' AND NEW.status IN ('published', 'withdrawn', 'failed'))
      OR (OLD.status = 'correction_queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'withdrawal_queued' AND NEW.status IN ('publishing', 'reconcile_required', 'failed'))
      OR (OLD.status = 'failed' AND NEW.status = CASE OLD.change_kind WHEN 'initial' THEN 'queued' WHEN 'correction' THEN 'correction_queued' ELSE 'withdrawal_queued' END))
  OR (OLD.status = 'failed' AND NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link JOIN internal_operation op ON op.operation_id=link.operation_id
    WHERE link.operation_id=NEW.operation_id
      AND link.semantic_action=CASE OLD.change_kind WHEN 'initial' THEN 'publish' WHEN 'correction' THEN 'correct' ELSE 'withdraw' END
      AND link.candidate_id=(SELECT candidate_id FROM bilingual_bundle_v1 WHERE bundle_id=NEW.bundle_id)
      AND op.state='authorized' AND op.owner_process='admin_http'
  ))
  OR (NEW.status = 'published' AND OLD.change_kind = 'withdrawal')
  OR (NEW.status = 'withdrawn' AND OLD.change_kind <> 'withdrawal')
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_PUBLICATION_TRANSITION_INVALID'); END;

CREATE TRIGGER bilingual_receipt_insert_guard
BEFORE INSERT ON bilingual_model_receipt_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.parent_operation_id IS NEW.parent_operation_id AND link.candidate_id = NEW.candidate_id
    AND link.language = NEW.language AND link.attempt_number = NEW.attempt_number AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
    AND op.owner_process = 'bilingual_refiner'
)
  OR NOT EXISTS (
    SELECT 1 FROM internal_external_attempt attempt
    JOIN internal_operation op ON op.operation_id = attempt.operation_id
    WHERE attempt.attempt_id = NEW.attempt_id
      AND attempt.operation_id = NEW.operation_id
      AND attempt.attempt_number = NEW.attempt_number
      AND op.expected_release_sha256 = NEW.release_sha256
      AND op.expected_manifest_sha256 = NEW.manifest_sha256
      AND attempt.route_id = NEW.model_route_ref
      AND attempt.external_calls = NEW.external_calls
      AND attempt.response_hash IS NEW.response_sha256
      AND attempt.state = NEW.attempt_state
      AND ((attempt.state = 'response_committed' AND attempt.outcome = 'succeeded' AND op.state = 'succeeded')
        OR (attempt.state = 'response_committed' AND attempt.outcome = 'known_failed' AND op.state = 'terminal_failed')
        OR (attempt.state = 'reconcile_required' AND attempt.outcome = 'unknown' AND op.state = 'reconcile_required'))
  )
  OR NOT EXISTS (
    SELECT 1 FROM budget_reservation reservation
    WHERE reservation.reservation_id = NEW.budget_reservation_id AND reservation.operation_id = NEW.operation_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_language_slot_v1 slot
    WHERE slot.slot_id = NEW.slot_id AND slot.candidate_id = NEW.candidate_id AND slot.language = NEW.language
      AND slot.prompt_schema_version = NEW.prompt_schema_version AND slot.prompt_sha256 = NEW.prompt_sha256
      AND slot.operation_id = NEW.operation_id
  )
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_receipt_no_delete
BEFORE DELETE ON bilingual_model_receipt_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_MODEL_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_receipt_no_update
BEFORE UPDATE ON bilingual_model_receipt_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_MODEL_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER bilingual_slot_insert_guard
BEFORE INSERT ON bilingual_language_slot_v1
WHEN NOT EXISTS (
  SELECT 1 FROM bilingual_authority_capability_v1 WHERE capability_id = 'bilingual-v1' AND enabled = 1
) OR NOT EXISTS (
  SELECT 1 FROM bilingual_operation_link_v1 link
  JOIN internal_operation op ON op.operation_id = link.operation_id
  WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
    AND link.language = NEW.language AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
    AND op.state = 'attempt_committed' AND op.owner_process = 'bilingual_refiner'
)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER bilingual_slot_no_delete
BEFORE DELETE ON bilingual_language_slot_v1
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SLOT_APPEND_ONLY'); END;

CREATE TRIGGER bilingual_slot_transition_guard
BEFORE UPDATE ON bilingual_language_slot_v1
WHEN NEW.slot_id <> OLD.slot_id OR NEW.candidate_id <> OLD.candidate_id OR NEW.language <> OLD.language
  OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at <= OLD.updated_at
  OR NEW.source_revision <> OLD.source_revision OR NEW.input_content_hash <> OLD.input_content_hash
  OR NEW.source_fact_set_hash <> OLD.source_fact_set_hash OR NEW.source_release_hash <> OLD.source_release_hash
  OR NEW.prompt_schema_version <> OLD.prompt_schema_version OR NEW.prompt_sha256 <> OLD.prompt_sha256
  OR NOT EXISTS (
    SELECT 1 FROM bilingual_operation_link_v1 link
    JOIN internal_operation op ON op.operation_id = link.operation_id
    WHERE link.operation_id = NEW.operation_id AND link.candidate_id = NEW.candidate_id
      AND link.language = NEW.language AND link.semantic_action IN ('refine_language', 'retry_language', 'rerun_language')
      AND op.owner_process = 'bilingual_refiner'
      AND ((NEW.state IN ('queued', 'stale', 'blocked') AND op.state = 'attempt_committed')
        OR (NEW.state = 'running' AND op.state = 'in_flight')
        OR (NEW.state = 'complete' AND op.state = 'succeeded')
        OR (NEW.state = 'failed' AND op.state = 'terminal_failed')
        OR (NEW.state = 'reconcile_required' AND op.state = 'reconcile_required'))
  )
  OR (OLD.state IN ('blocked', 'failed', 'stale', 'complete') AND NEW.state = 'queued' AND NEW.operation_id = OLD.operation_id)
  OR (OLD.state = 'complete' AND NEW.state = 'stale' AND NEW.operation_id = OLD.operation_id)
  OR (NOT ((OLD.state IN ('blocked', 'failed', 'stale', 'complete') AND NEW.state = 'queued') OR (OLD.state = 'complete' AND NEW.state = 'stale')) AND NEW.operation_id <> OLD.operation_id)
  OR (OLD.state IN ('reconcile_required', 'stale') AND NEW.state IN ('running', 'complete', 'failed', 'reconcile_required')
      AND (NEW.operation_id <> OLD.operation_id OR NEW.current_attempt_id IS NOT OLD.current_attempt_id OR NEW.current_attempt_operation_id IS NOT OLD.current_attempt_operation_id))
  OR (OLD.state = 'running' AND (NEW.current_attempt_id IS NOT OLD.current_attempt_id OR NEW.current_attempt_operation_id IS NOT OLD.current_attempt_operation_id))
  OR (NEW.current_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bilingual_model_receipt_v1 WHERE attempt_id = NEW.current_attempt_id AND operation_id = NEW.current_attempt_operation_id AND slot_id = NEW.slot_id AND candidate_id = NEW.candidate_id AND language = NEW.language))
  OR (OLD.state = 'queued' AND NEW.current_attempt_id IS NOT NULL AND NEW.current_attempt_operation_id <> NEW.operation_id)
  OR NOT (
    (OLD.state = 'missing' AND NEW.state = 'queued') OR
    (OLD.state IN ('queued', 'running') AND NEW.state IN ('running', 'complete', 'blocked', 'failed', 'reconcile_required')) OR
    (OLD.state = 'complete' AND NEW.state IN ('stale', 'queued')) OR
    (OLD.state IN ('blocked', 'failed', 'stale') AND NEW.state = 'queued') OR
    (OLD.state = 'stale' AND NEW.state = 'reconcile_required') OR
    (OLD.state = 'reconcile_required' AND NEW.state IN ('running', 'complete', 'failed'))
  )
  OR (NEW.state = 'queued' AND (NEW.current_attempt_id IS NOT NULL OR NEW.current_attempt_operation_id IS NOT NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'running' AND (NEW.current_attempt_id IS NULL OR NEW.current_attempt_operation_id IS NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'complete' AND (NEW.current_attempt_id IS NULL OR NEW.model_route_receipt_hash IS NULL OR NEW.draft_hash IS NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'stale' AND (NEW.current_attempt_id IS NULL OR NEW.model_route_receipt_hash IS NOT NULL OR NEW.draft_hash IS NOT NULL OR NEW.failure_reason IS NOT NULL))
  OR (NEW.state = 'reconcile_required' AND NEW.current_attempt_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'BILINGUAL_SLOT_TRANSITION_INVALID'); END;

CREATE TRIGGER budget_account_no_delete BEFORE DELETE ON budget_account BEGIN SELECT RAISE(ABORT,'BUDGET_ACCOUNT_IMMUTABLE'); END;

CREATE TRIGGER budget_account_update_guard BEFORE UPDATE ON budget_account
WHEN NEW.version<>OLD.version+1 OR NEW.account_id<>OLD.account_id OR NEW.unit_kind<>OLD.unit_kind OR NEW.hard_limit<>OLD.hard_limit
  OR NEW.consumed_units<OLD.consumed_units OR NEW.reserved_units<0 OR NEW.consumed_units+NEW.reserved_units>NEW.hard_limit
BEGIN SELECT RAISE(ABORT,'BUDGET_ACCOUNT_TRANSITION_INVALID'); END;

CREATE TRIGGER budget_reservation_account_consume AFTER UPDATE OF state ON budget_reservation WHEN NEW.state='consumed'
BEGIN UPDATE budget_account SET reserved_units=reserved_units-NEW.units,consumed_units=consumed_units+NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;

CREATE TRIGGER budget_reservation_account_release AFTER UPDATE OF state ON budget_reservation WHEN NEW.state='released'
BEGIN UPDATE budget_account SET reserved_units=reserved_units-NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;

CREATE TRIGGER budget_reservation_account_reserve AFTER INSERT ON budget_reservation
BEGIN UPDATE budget_account SET reserved_units=reserved_units+NEW.units,version=version+1 WHERE account_id=NEW.account_id; END;

CREATE TRIGGER budget_reservation_insert_guard BEFORE INSERT ON budget_reservation
WHEN NEW.state<>'reserved' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op JOIN budget_account account ON account.account_id=NEW.account_id
    WHERE op.operation_id=NEW.operation_id AND op.budget_reservation_id=NEW.reservation_id
      AND op.state='requested' AND account.consumed_units+account.reserved_units+NEW.units<=account.hard_limit)
BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_INVALID'); END;

CREATE TRIGGER budget_reservation_no_delete BEFORE DELETE ON budget_reservation BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_IMMUTABLE'); END;

CREATE TRIGGER budget_reservation_transition_guard BEFORE UPDATE ON budget_reservation
WHEN NEW.version<>OLD.version+1 OR NEW.reservation_id<>OLD.reservation_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.account_id<>OLD.account_id OR NEW.units<>OLD.units OR NEW.created_at<>OLD.created_at
  OR NOT ((OLD.state='reserved' AND NEW.state IN ('consumed','released','reconcile_required'))
    OR (OLD.state='reconcile_required' AND NEW.state IN ('consumed','released')))
BEGIN SELECT RAISE(ABORT,'BUDGET_RESERVATION_TRANSITION_INVALID'); END;

CREATE TRIGGER gateway_admin_operation_insert_guard BEFORE INSERT ON admin_operation
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='legacy_admin_operation' AND p.entity_id=NEW.operation_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_audit_event_insert_guard BEFORE INSERT ON audit_event
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='legacy_audit' AND p.entity_id=NEW.event_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_candidate_delete_guard BEFORE DELETE ON pending_review_candidate BEGIN SELECT RAISE(ABORT,'LEGACY_DELETE_FORBIDDEN'); END;

CREATE TRIGGER gateway_candidate_insert_guard BEFORE INSERT ON pending_review_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='candidate' AND p.entity_id=NEW.candidate_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_candidate_update_guard BEFORE UPDATE ON pending_review_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='candidate' AND p.entity_id=OLD.candidate_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_entity_policy_no_delete BEFORE DELETE ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER gateway_entity_policy_no_insert BEFORE INSERT ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER gateway_entity_policy_no_update BEFORE UPDATE ON gateway_entity_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER gateway_ingest_run_delete_guard BEFORE DELETE ON ingest_run BEGIN SELECT RAISE(ABORT,'LEGACY_DELETE_FORBIDDEN'); END;

CREATE TRIGGER gateway_ingest_run_insert_guard BEFORE INSERT ON ingest_run
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='ingest_run' AND p.entity_id=NEW.run_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_ingest_run_update_guard BEFORE UPDATE ON ingest_run
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='ingest_run' AND p.entity_id=OLD.run_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_machine_draft_insert_guard BEFORE INSERT ON machine_summary_draft
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='machine_draft' AND p.entity_id=NEW.draft_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_projection_insert_guard BEFORE INSERT ON published_projection
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='published_projection' AND p.entity_id=NEW.projection_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_projection_outbox_insert_guard BEFORE INSERT ON projection_outbox
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_outbox' AND p.entity_id=NEW.delivery_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_projection_outbox_update_guard BEFORE UPDATE ON projection_outbox
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_outbox' AND p.entity_id=OLD.delivery_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_projection_receipt_insert_guard BEFORE INSERT ON projection_delivery_receipt
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='projection_receipt' AND p.entity_id=NEW.delivery_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_publication_insert_guard BEFORE INSERT ON publication
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='publication' AND p.entity_id=NEW.publication_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_publication_update_guard BEFORE UPDATE ON publication
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='publication' AND p.entity_id=OLD.publication_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_review_bundle_insert_guard BEFORE INSERT ON review_bundle
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='review_bundle' AND p.entity_id=NEW.bundle_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_review_decision_insert_guard BEFORE INSERT ON review_decision
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='review_decision' AND p.entity_id=NEW.decision_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_rss_media_insert_guard BEFORE INSERT ON rss_media_candidate
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='rss_media' AND p.entity_id=NEW.candidate_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_source_delete_guard BEFORE DELETE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='delete' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_source_insert_guard BEFORE INSERT ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=NEW.source_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_source_update_guard BEFORE UPDATE ON source
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_REQUIRED'); END;

CREATE TRIGGER gateway_write_permit_insert_guard BEFORE INSERT ON gateway_write_permit
WHEN NOT EXISTS(SELECT 1 FROM internal_operation op JOIN gateway_entity_policy ep
  ON ep.operation_kind=op.operation_kind AND ep.capability_class=op.capability_class
  JOIN operation_entity_binding binding ON binding.operation_id=op.operation_id
    AND binding.entity_kind=NEW.entity_kind AND binding.entity_id=NEW.entity_id
  WHERE op.operation_id=NEW.operation_id AND op.state='authorized'
    AND ep.entity_kind=NEW.entity_kind AND ep.mutation_kind=NEW.mutation_kind
    AND ep.identity_selector=binding.identity_selector
    AND binding.expected_entity_version IS NEW.expected_entity_version
    AND binding.expected_entity_hash=NEW.expected_entity_hash
    AND binding.entity_set_hash=op.entity_set_hash
    AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
      WHERE f.operation_id=op.operation_id AND (f.prechecked_at IS NULL OR f.consumed_at IS NULL
        OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
        OR receipt.policy_epoch<>op.policy_epoch OR receipt.recovery_epoch<>op.recovery_epoch
        OR receipt.writer_epoch<>op.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.created_at))))
BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_POLICY_INVALID'); END;

CREATE TRIGGER gateway_write_permit_no_delete BEFORE DELETE ON gateway_write_permit BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER gateway_write_permit_update_guard BEFORE UPDATE ON gateway_write_permit
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.entity_kind<>OLD.entity_kind OR NEW.entity_id<>OLD.entity_id OR NEW.mutation_kind<>OLD.mutation_kind
  OR NEW.expected_entity_version IS NOT OLD.expected_entity_version OR NEW.expected_entity_hash<>OLD.expected_entity_hash
  OR NEW.created_at<>OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'WRITE_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER generic_fence_receipt_insert_guard BEFORE INSERT ON generic_fence_receipt
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  WHERE p.entity_kind='generic_fence' AND p.entity_id=NEW.fence_receipt_id AND p.mutation_kind='insert'
    AND p.consumed_at IS NULL AND op.operation_id=NEW.issued_by_operation_id AND op.state='authorized'
    AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
    AND op.capability_class='control' AND op.control_action='fence_update'
    AND op.policy_epoch=NEW.policy_epoch AND op.recovery_epoch=NEW.recovery_epoch
    AND op.expected_writer_epoch=NEW.writer_epoch)
BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_ISSUER_INVALID'); END;

CREATE TRIGGER generic_fence_receipt_no_delete BEFORE DELETE ON generic_fence_receipt BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER generic_fence_receipt_no_update BEFORE UPDATE ON generic_fence_receipt BEGIN SELECT RAISE(ABORT,'FENCE_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER internal_control_action_policy_no_delete BEFORE DELETE ON internal_control_action_policy
BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_control_action_policy_no_insert BEFORE INSERT ON internal_control_action_policy BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_control_action_policy_no_update BEFORE UPDATE ON internal_control_action_policy
BEGIN SELECT RAISE(ABORT,'CONTROL_ACTION_POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_control_transition_guard
BEFORE UPDATE ON internal_control
WHEN NEW.version<>OLD.version+1
  OR NEW.updated_by_operation_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM internal_operation op
    JOIN internal_operation_policy policy ON policy.policy_id=op.policy_id
    JOIN internal_control_action_policy action_policy ON action_policy.policy_id=op.policy_id
      AND action_policy.owner_process=op.owner_process
      AND action_policy.operation_kind=op.operation_kind
      AND action_policy.capability_class=op.capability_class
      AND action_policy.control_action=op.control_action
    JOIN gateway_write_permit permit ON permit.operation_id=op.operation_id
      AND permit.entity_kind='internal_control' AND permit.entity_id='1'
      AND permit.mutation_kind='update' AND permit.consumed_at IS NULL
    WHERE op.operation_id=NEW.updated_by_operation_id
      AND op.operation_kind IN ('phase_control','restore')
      AND op.owner_process IN ('admin_http','restore_operator','system_supervisor')
      AND op.state='authorized'
      AND op.recovery_epoch=OLD.recovery_epoch
  )
  OR NOT EXISTS(
    SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.updated_by_operation_id AND (
      (op.control_action IN ('enter_backlog','enter_live','pause','disable')
        AND NEW.global_stop_state=OLD.global_stop_state AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256
        AND ((op.control_action='enter_backlog' AND OLD.phase IN ('disabled','paused') AND NEW.phase='backlog')
          OR (op.control_action='enter_live' AND OLD.phase IN ('backlog','paused') AND NEW.phase='live')
          OR (op.control_action='pause' AND OLD.phase IN ('disabled','backlog','live') AND NEW.phase='paused')
          OR (op.control_action='disable' AND OLD.phase='paused' AND NEW.phase='disabled')))
      OR (op.control_action='set_global_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND OLD.global_stop_state='clear' AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='set_emergency_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state='stopped' AND OLD.emergency_stop_state='clear'
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='clear_emergency_stop' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND OLD.emergency_stop_state='stopped' AND NEW.emergency_stop_state='clear'
        AND NEW.recovery_state=OLD.recovery_state AND NEW.deletion_fence_state=OLD.deletion_fence_state
        AND NEW.publication_fence_state=OLD.publication_fence_state AND NEW.source_config_epoch=OLD.source_config_epoch
        AND NEW.source_safety_epoch=OLD.source_safety_epoch AND NEW.authorization_version=OLD.authorization_version
        AND NEW.policy_epoch=OLD.policy_epoch AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='clear_global_stop' AND NEW.phase=OLD.phase AND OLD.global_stop_state='stopped'
        AND NEW.global_stop_state='clear' AND NEW.emergency_stop_state='clear' AND NEW.recovery_state='ready'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_begin' AND NEW.phase IN ('disabled','paused') AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state IN ('ready','failed') AND NEW.recovery_state='fenced'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_advance' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND ((OLD.recovery_state='fenced' AND NEW.recovery_state='restoring')
          OR (OLD.recovery_state='restoring' AND NEW.recovery_state='verifying'))
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='recovery_abort' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state
        AND OLD.recovery_state IN ('fenced','restoring','verifying') AND NEW.recovery_state='failed'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='writer_epoch_bump' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state='verifying' AND NEW.recovery_state='verifying'
        AND NEW.recovery_epoch=OLD.recovery_epoch+1 AND NEW.writer_epoch=OLD.writer_epoch+1
        AND NEW.writer_authority_receipt_sha256<>OLD.writer_authority_receipt_sha256
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch>=OLD.source_config_epoch AND NEW.source_safety_epoch>=OLD.source_safety_epoch
        AND NEW.authorization_version>=OLD.authorization_version AND NEW.policy_epoch>=OLD.policy_epoch)
      OR (op.control_action='recovery_complete' AND NEW.phase=OLD.phase AND NEW.global_stop_state='stopped'
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND OLD.recovery_state='verifying' AND NEW.recovery_state='ready'
        AND NEW.deletion_fence_state=OLD.deletion_fence_state AND NEW.publication_fence_state=OLD.publication_fence_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
      OR (op.control_action='fence_update' AND NEW.phase=OLD.phase AND NEW.global_stop_state=OLD.global_stop_state
        AND NEW.emergency_stop_state=OLD.emergency_stop_state AND NEW.recovery_state=OLD.recovery_state
        AND NEW.source_config_epoch=OLD.source_config_epoch AND NEW.source_safety_epoch=OLD.source_safety_epoch
        AND NEW.authorization_version=OLD.authorization_version AND NEW.policy_epoch=OLD.policy_epoch
        AND NEW.recovery_epoch=OLD.recovery_epoch AND NEW.writer_epoch=OLD.writer_epoch
        AND NEW.writer_authority_receipt_sha256=OLD.writer_authority_receipt_sha256)
    )
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_CONTROL_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_external_attempt_budget_guard
BEFORE UPDATE ON internal_external_attempt
WHEN (NEW.state='reconcile_required' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='reconcile_required'))
  OR (NEW.state='response_committed' AND NEW.outcome='succeeded' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='consumed'))
  OR (NEW.state IN ('response_committed','terminal_failed') AND NEW.outcome='known_failed' AND NOT EXISTS(SELECT 1 FROM budget_reservation r JOIN internal_operation op ON op.budget_reservation_id=r.reservation_id WHERE op.operation_id=NEW.operation_id AND r.state='released'))
BEGIN SELECT RAISE(ABORT,'ATTEMPT_BUDGET_STATE_INVALID'); END;

CREATE TRIGGER internal_external_attempt_insert_guard
BEFORE INSERT ON internal_external_attempt
WHEN NEW.state<>'intent_committed' OR NEW.external_calls<>0 OR NEW.outcome<>'pending'
  OR NOT EXISTS(SELECT 1 FROM internal_operation op
    JOIN route_registry route ON route.route_id=NEW.route_id
    JOIN budget_reservation reservation ON reservation.reservation_id=op.budget_reservation_id
    WHERE op.operation_id=NEW.operation_id AND op.state='attempt_committed'
      AND op.capability_class IN ('external_attempt','backup','restore','reconcile_readonly')
      AND NEW.attempt_number=op.attempt AND NEW.canonical_request_hash=op.request_hash
      AND NEW.request_fingerprint=op.request_fingerprint
      AND route.egress_class=op.egress_class AND route.state='active'
      AND json_extract(NEW.canonical_request_json,'$.schemaVersion')='external-request-v1'
      AND json_extract(NEW.canonical_request_json,'$.routeId')=NEW.route_id
      AND json_extract(NEW.canonical_request_json,'$.endpointClass')=NEW.endpoint_class
      AND json_extract(NEW.canonical_request_json,'$.providerResource')=NEW.provider_resource_identity
      AND json_extract(NEW.canonical_request_json,'$.externalIdempotencyKey')=NEW.external_idempotency_key
      AND json_extract(NEW.canonical_request_json,'$.reconcileKey')=NEW.reconcile_key
      AND json_extract(NEW.canonical_request_json,'$.expected.routeIdentitySha256')=route.endpoint_identity_sha256
      AND route.endpoint_class=NEW.endpoint_class
      AND reservation.operation_id=op.operation_id AND reservation.state='reserved'
      AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
        JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
        WHERE f.operation_id=op.operation_id AND (f.prechecked_at IS NULL OR f.consumed_at IS NULL
          OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
          OR receipt.policy_epoch<>op.policy_epoch OR receipt.recovery_epoch<>op.recovery_epoch
          OR receipt.writer_epoch<>op.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.committed_at))))
BEGIN SELECT RAISE(ABORT,'EXTERNAL_ATTEMPT_INTENT_INVALID'); END;

CREATE TRIGGER internal_external_attempt_no_delete
BEFORE DELETE ON internal_external_attempt BEGIN SELECT RAISE(ABORT,'INTERNAL_ATTEMPT_IMMUTABLE'); END;

CREATE TRIGGER internal_external_attempt_transition_guard
BEFORE UPDATE ON internal_external_attempt
WHEN NEW.attempt_id<>OLD.attempt_id
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.attempt_number<>OLD.attempt_number
  OR NEW.attempt_nonce<>OLD.attempt_nonce
  OR NEW.route_id<>OLD.route_id OR NEW.endpoint_class<>OLD.endpoint_class
  OR NEW.external_idempotency_key<>OLD.external_idempotency_key
  OR NEW.reconcile_key<>OLD.reconcile_key
  OR NEW.provider_resource_identity IS NOT OLD.provider_resource_identity
  OR NEW.canonical_request_json<>OLD.canonical_request_json
  OR NEW.canonical_request_hash<>OLD.canonical_request_hash
  OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.reconcile_identity_sha256<>OLD.reconcile_identity_sha256
  OR (NEW.response_identity_sha256 IS NOT OLD.response_identity_sha256
    AND NOT (OLD.response_identity_sha256 IS NULL AND NEW.response_identity_sha256 IS NOT NULL
      AND NEW.state IN ('response_committed','terminal_failed')))
  OR (NEW.response_hash IS NOT OLD.response_hash
    AND NOT (OLD.response_hash IS NULL AND NEW.response_hash IS NOT NULL
      AND NEW.state IN ('response_committed','terminal_failed')))
  OR NEW.committed_at<>OLD.committed_at
  OR NOT (
    (OLD.state='intent_committed' AND NEW.state IN ('started','response_committed','reconcile_required','terminal_failed')) OR
    (OLD.state='started' AND NEW.state IN ('response_committed','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('response_committed','terminal_failed'))
  )
  OR (NEW.state='started' AND (NEW.external_calls<>1 OR NEW.outcome<>'pending'))
  OR (NEW.state='response_committed' AND (NEW.external_calls<>1 OR NEW.outcome NOT IN ('succeeded','known_failed')))
  OR (NEW.state='reconcile_required' AND NEW.outcome<>'unknown')
  OR (NEW.state='terminal_failed' AND NEW.outcome<>'known_failed')
  OR (OLD.state='reconcile_required' AND NEW.reconcile_consumed_at IS NULL)
  OR (OLD.reconcile_consumed_at IS NOT NULL AND NEW.reconcile_consumed_at<>OLD.reconcile_consumed_at)
BEGIN SELECT RAISE(ABORT,'INTERNAL_ATTEMPT_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_external_attempt_unknown_guard
BEFORE UPDATE ON internal_external_attempt
WHEN NEW.outcome='unknown' AND NOT EXISTS(
  SELECT 1 FROM internal_operation op
  WHERE op.operation_id=NEW.operation_id AND op.state='reconcile_required'
)
BEGIN SELECT RAISE(ABORT,'UNKNOWN_OUTCOME_RECONCILE_REQUIRED'); END;

CREATE TRIGGER internal_operation_audit_no_delete
BEFORE DELETE ON internal_operation_audit BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_audit_no_update
BEFORE UPDATE ON internal_operation_audit BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_audit_predecessor_guard
BEFORE INSERT ON internal_operation_audit
WHEN (NOT EXISTS(SELECT 1 FROM internal_operation_audit) AND NEW.previous_event_hash IS NOT NULL)
  OR (EXISTS(SELECT 1 FROM internal_operation_audit) AND NEW.previous_event_hash IS NOT
      (SELECT event_hash FROM internal_operation_audit ORDER BY audit_seq DESC LIMIT 1))
BEGIN SELECT RAISE(ABORT,'INTERNAL_AUDIT_PREDECESSOR_INVALID'); END;

CREATE TRIGGER internal_operation_authorize_guard
BEFORE UPDATE OF state ON internal_operation
WHEN NEW.state='authorized' AND (
  OLD.state<>'requested'
  OR NOT EXISTS(SELECT 1 FROM owner_authorization_handoff h WHERE h.handoff_id=NEW.authorization_handoff_id AND h.consumed_by_operation_id=NEW.operation_id)
  OR NOT EXISTS(SELECT 1 FROM internal_control c WHERE c.singleton_id=1
    AND c.version=NEW.expected_control_version
    AND c.phase=NEW.phase
    AND c.source_config_epoch=NEW.source_config_epoch
    AND c.source_safety_epoch=NEW.source_safety_epoch
    AND c.authorization_version=NEW.authorization_version
    AND c.policy_epoch=NEW.policy_epoch
    AND c.recovery_epoch=NEW.recovery_epoch
    AND c.writer_epoch=NEW.expected_writer_epoch
    AND c.global_stop_state=NEW.global_stop_state
    AND c.emergency_stop_state=NEW.emergency_stop_state
    AND c.recovery_state=NEW.recovery_state
    AND c.deletion_fence_state=NEW.deletion_fence_state
    AND c.publication_fence_state=NEW.publication_fence_state)
  OR NOT EXISTS(SELECT 1 FROM internal_operation_policy p WHERE p.policy_id=NEW.policy_id
    AND (p.allow_global_stop=1 OR NEW.global_stop_state='clear')
    AND (p.allow_emergency_stop=1 OR NEW.emergency_stop_state='clear')
    AND (p.allowed_recovery_state='any'
      OR (p.allowed_recovery_state='ready' AND NEW.recovery_state='ready')
      OR (p.allowed_recovery_state='not_ready' AND NEW.recovery_state<>'ready'))
    AND (p.deletion_fence_mode IN ('not_applicable','reconcile_only') OR NEW.deletion_fence_state='clear')
    AND (p.publication_fence_mode IN ('not_applicable','reconcile_only') OR NEW.publication_fence_state='clear'))
  OR (NEW.control_action IS NOT NULL AND NOT EXISTS(SELECT 1 FROM internal_control_action_policy ap
    WHERE ap.policy_id=NEW.policy_id AND ap.owner_process=NEW.owner_process
      AND ap.operation_kind=NEW.operation_kind AND ap.capability_class=NEW.capability_class
      AND ap.control_action=NEW.control_action))
  OR json_array_length(NEW.entity_set_json)<>(SELECT count(*) FROM operation_entity_binding b WHERE b.operation_id=NEW.operation_id)
  OR json_array_length(NEW.entity_set_json)<>(SELECT count(DISTINCT json_extract(value,'$.entityKind')||char(0)||json_extract(value,'$.entityId')) FROM json_each(NEW.entity_set_json))
  OR EXISTS(SELECT 1 FROM json_each(NEW.entity_set_json) item
    WHERE json_type(item.value)<>'object' OR NOT EXISTS(SELECT 1 FROM operation_entity_binding b
      WHERE b.operation_id=NEW.operation_id
        AND b.entity_kind=json_extract(item.value,'$.entityKind')
        AND b.entity_id=json_extract(item.value,'$.entityId')
        AND b.expected_entity_version IS json_extract(item.value,'$.expectedVersion')
        AND b.expected_entity_hash=json_extract(item.value,'$.expectedHash')
        AND b.entity_set_hash=NEW.entity_set_hash))
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='source_id' AND b.entity_id=NEW.source_id))
  OR (NEW.candidate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='candidate_id' AND b.entity_id=NEW.candidate_id))
  OR (NEW.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='publication_id' AND b.entity_id=NEW.publication_id))
  OR (NEW.public_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operation_entity_binding b
    WHERE b.operation_id=NEW.operation_id AND b.identity_selector='public_id' AND b.entity_id=NEW.public_id))
  OR (SELECT count(*) FROM internal_required_fence_policy template WHERE template.policy_id=NEW.policy_id)
    <>(SELECT count(*) FROM operation_fence_binding f WHERE f.operation_id=NEW.operation_id)
  OR EXISTS(SELECT 1 FROM internal_required_fence_policy template
    WHERE template.policy_id=NEW.policy_id AND NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      WHERE f.operation_id=NEW.operation_id AND f.fence_kind=template.fence_kind
        AND f.required_state=template.required_state
        AND ((template.scope_selector='global' AND f.scope_kind='global' AND f.scope_id IS NULL)
          OR (template.scope_selector='source_id' AND f.scope_kind='source' AND f.scope_id=NEW.source_id)
          OR (template.scope_selector='candidate_id' AND f.scope_kind='candidate' AND f.scope_id=NEW.candidate_id)
          OR (template.scope_selector='publication_id' AND f.scope_kind='publication' AND f.scope_id=NEW.publication_id))))
  OR json_array_length(NEW.required_fence_set_json)<>(SELECT count(*) FROM operation_fence_binding f WHERE f.operation_id=NEW.operation_id)
  OR json_array_length(NEW.required_fence_set_json)<>(SELECT count(DISTINCT json_extract(value,'$.fenceReceiptId')) FROM json_each(NEW.required_fence_set_json))
  OR EXISTS(SELECT 1 FROM json_each(NEW.required_fence_set_json) item
    WHERE json_type(item.value)<>'object' OR NOT EXISTS(SELECT 1 FROM operation_fence_binding f
      JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
      WHERE f.operation_id=NEW.operation_id
        AND f.fence_receipt_id=json_extract(item.value,'$.fenceReceiptId')
        AND f.receipt_sha256=json_extract(item.value,'$.receiptSha256')
        AND f.scope_kind=json_extract(item.value,'$.scopeKind')
        AND f.scope_id IS json_extract(item.value,'$.scopeId')
        AND f.fence_kind=json_extract(item.value,'$.fenceKind')
        AND f.prechecked_at IS NOT NULL AND f.consumed_at=f.prechecked_at
        AND f.fence_set_hash=NEW.required_fence_set_hash
        AND receipt.receipt_sha256=f.receipt_sha256 AND receipt.state<>'unknown'
        AND ((f.required_state='clear' AND receipt.state='clear')
          OR (f.required_state='blocked_reconcile_readonly' AND NEW.capability_class='reconcile_readonly' AND receipt.state IN ('clear','blocked'))
          OR (f.required_state='clear_or_blocked_removal' AND NEW.operation_kind='withdraw' AND receipt.state IN ('clear','blocked')))
        AND receipt.policy_epoch=NEW.policy_epoch AND receipt.recovery_epoch=NEW.recovery_epoch
        AND receipt.writer_epoch=NEW.expected_writer_epoch
        AND unixepoch(receipt.expires_at)>unixepoch(NEW.updated_at)))
  OR (NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source s WHERE s.source_id=NEW.source_id AND s.stop_epoch=NEW.source_stop_epoch
      AND (EXISTS(SELECT 1 FROM internal_operation_policy p WHERE p.policy_id=NEW.policy_id AND p.source_fence_mode IN ('not_applicable','quarantine_only')) OR s.enabled=1)))
)
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_AUTHORIZATION_INVALID'); END;

CREATE TRIGGER internal_operation_fence_terminal_guard
BEFORE UPDATE OF state ON internal_operation
WHEN NEW.state='succeeded' AND EXISTS(SELECT 1 FROM operation_fence_binding f
  JOIN generic_fence_receipt receipt ON receipt.fence_receipt_id=f.fence_receipt_id
  WHERE f.operation_id=NEW.operation_id AND (f.postchecked_at IS NULL
    OR receipt.receipt_sha256<>f.receipt_sha256 OR receipt.state='unknown'
    OR receipt.policy_epoch<>NEW.policy_epoch OR receipt.recovery_epoch<>NEW.recovery_epoch
    OR receipt.writer_epoch<>NEW.expected_writer_epoch OR unixepoch(receipt.expires_at)<=unixepoch(NEW.updated_at)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_POSTCHECK_REQUIRED'); END;

CREATE TRIGGER internal_operation_insert_guard
BEFORE INSERT ON internal_operation
WHEN NEW.state<>'requested'
  OR NOT EXISTS(
    SELECT 1 FROM internal_operation_policy p
    JOIN owner_authorization_handoff h ON h.handoff_id=NEW.authorization_handoff_id
    WHERE p.policy_id=NEW.policy_id
      AND p.owner_process=NEW.owner_process AND p.operation_kind=NEW.operation_kind
      AND p.capability_class=NEW.capability_class AND p.phase=NEW.phase
      AND p.egress_class=NEW.egress_class
      AND ((NEW.control_action IS NULL AND NOT EXISTS(
          SELECT 1 FROM internal_control_action_policy ap WHERE ap.policy_id=p.policy_id))
        OR EXISTS(SELECT 1 FROM internal_control_action_policy ap
          WHERE ap.policy_id=p.policy_id AND ap.owner_process=NEW.owner_process
            AND ap.operation_kind=NEW.operation_kind AND ap.capability_class=NEW.capability_class
            AND ap.control_action=NEW.control_action))
      AND h.owner_process=NEW.owner_process
      AND h.release_sha256=NEW.expected_release_sha256
      AND h.manifest_sha256=NEW.expected_manifest_sha256
      AND h.consumed_by_operation_id IS NULL
      AND unixepoch(h.verified_at) IS NOT NULL AND unixepoch(h.expires_at)>unixepoch(NEW.created_at)
      AND ((p.required_identity='none')
        OR (p.required_identity='source' AND NEW.source_id IS NOT NULL)
        OR (p.required_identity='candidate' AND NEW.candidate_id IS NOT NULL)
        OR (p.required_identity='publication' AND NEW.publication_id IS NOT NULL)
        OR (p.required_identity='source_candidate' AND NEW.source_id IS NOT NULL AND NEW.candidate_id IS NOT NULL)
        OR (p.required_identity='publication_public' AND NEW.publication_id IS NOT NULL AND NEW.public_id IS NOT NULL))
  )
BEGIN SELECT RAISE(ABORT,'OWNER_OPERATION_POLICY_INVALID'); END;

CREATE TRIGGER internal_operation_no_delete
BEFORE DELETE ON internal_operation BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_outbox_no_delete
BEFORE DELETE ON internal_operation_outbox BEGIN SELECT RAISE(ABORT,'INTERNAL_OUTBOX_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_outbox_transition_guard
BEFORE UPDATE ON internal_operation_outbox
WHEN NEW.version<>OLD.version+1
  OR NEW.outbox_id<>OLD.outbox_id
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.outbox_kind<>OLD.outbox_kind
  OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.payload_json<>OLD.payload_json
  OR NEW.payload_hash<>OLD.payload_hash
  OR NEW.created_at<>OLD.created_at
  OR NOT (
    (OLD.state='pending' AND NEW.state IN ('leased','cancelled')) OR
    (OLD.state='leased' AND NEW.state IN ('succeeded','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('succeeded','terminal_failed','cancelled'))
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_OUTBOX_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_operation_policy_no_delete BEFORE DELETE ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_policy_no_insert BEFORE INSERT ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_policy_no_update BEFORE UPDATE ON internal_operation_policy BEGIN SELECT RAISE(ABORT,'POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_operation_transition_guard
BEFORE UPDATE ON internal_operation
WHEN NEW.version<>OLD.version+1
  OR NEW.operation_id<>OLD.operation_id
  OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.operation_kind<>OLD.operation_kind
  OR NEW.owner_process<>OLD.owner_process
  OR NEW.capability_class<>OLD.capability_class
  OR NEW.policy_id<>OLD.policy_id
  OR NEW.authorization_handoff_id<>OLD.authorization_handoff_id
  OR NEW.control_action IS NOT OLD.control_action
  OR NEW.candidate_id IS NOT OLD.candidate_id
  OR NEW.source_id IS NOT OLD.source_id
  OR NEW.publication_id IS NOT OLD.publication_id
  OR NEW.public_id IS NOT OLD.public_id
  OR NEW.phase<>OLD.phase
  OR NEW.budget_reservation_id IS NOT OLD.budget_reservation_id
  OR NEW.egress_class<>OLD.egress_class
  OR NEW.model_route_ref IS NOT OLD.model_route_ref
  OR NEW.expected_schema_sha256<>OLD.expected_schema_sha256
  OR NEW.expected_release_sha256<>OLD.expected_release_sha256
  OR NEW.expected_manifest_sha256<>OLD.expected_manifest_sha256
  OR NEW.source_config_epoch<>OLD.source_config_epoch
  OR NEW.source_safety_epoch<>OLD.source_safety_epoch
  OR NEW.authorization_version<>OLD.authorization_version
  OR NEW.policy_epoch<>OLD.policy_epoch
  OR NEW.recovery_epoch<>OLD.recovery_epoch
  OR NEW.source_stop_epoch IS NOT OLD.source_stop_epoch
  OR NEW.global_stop_state<>OLD.global_stop_state
  OR NEW.emergency_stop_state<>OLD.emergency_stop_state
  OR NEW.recovery_state<>OLD.recovery_state
  OR NEW.deletion_fence_state<>OLD.deletion_fence_state
  OR NEW.publication_fence_state<>OLD.publication_fence_state
  OR NEW.request_hash<>OLD.request_hash
  OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.expected_control_version<>OLD.expected_control_version
  OR NEW.expected_entity_version IS NOT OLD.expected_entity_version
  OR NEW.expected_entity_hash<>OLD.expected_entity_hash
  OR NEW.entity_set_json<>OLD.entity_set_json OR NEW.entity_set_hash<>OLD.entity_set_hash
  OR NEW.required_fence_set_json<>OLD.required_fence_set_json OR NEW.required_fence_set_hash<>OLD.required_fence_set_hash
  OR NEW.expected_writer_epoch<>OLD.expected_writer_epoch
  OR NEW.created_at<>OLD.created_at
  OR NOT (
    (OLD.state='requested' AND NEW.state IN ('authorized','blocked','cancelled')) OR
    (OLD.state='authorized' AND NEW.state IN ('attempt_committed','succeeded','blocked','cancelled')) OR
    (OLD.state='attempt_committed' AND NEW.state IN ('in_flight','reconcile_required','terminal_failed')) OR
    (OLD.state='in_flight' AND NEW.state IN ('succeeded','reconcile_required','terminal_failed')) OR
    (OLD.state='reconcile_required' AND NEW.state IN ('succeeded','terminal_failed','cancelled'))
  )
BEGIN SELECT RAISE(ABORT,'INTERNAL_OPERATION_TRANSITION_INVALID'); END;

CREATE TRIGGER internal_required_fence_policy_no_delete BEFORE DELETE ON internal_required_fence_policy
BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_required_fence_policy_no_insert BEFORE INSERT ON internal_required_fence_policy BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;

CREATE TRIGGER internal_required_fence_policy_no_update BEFORE UPDATE ON internal_required_fence_policy
BEGIN SELECT RAISE(ABORT,'REQUIRED_FENCE_POLICY_IMMUTABLE'); END;

CREATE TRIGGER machine_summary_draft_insert_guard
BEFORE INSERT ON machine_summary_draft
WHEN EXISTS (
  SELECT 1 FROM machine_summary_draft AS existing
  WHERE existing.draft_id = NEW.draft_id OR (
    existing.candidate_id = NEW.candidate_id AND
    existing.source_revision = NEW.source_revision AND
    existing.source_payload_hash = NEW.source_payload_hash AND
    existing.model = NEW.model AND
    existing.prompt_sha256 = NEW.prompt_sha256
  )
) OR NOT EXISTS (
  SELECT 1 FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
)
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IDENTITY_INVALID');
END;

CREATE TRIGGER machine_summary_draft_no_delete
BEFORE DELETE ON machine_summary_draft
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IMMUTABLE');
END;

CREATE TRIGGER machine_summary_draft_no_update
BEFORE UPDATE ON machine_summary_draft
BEGIN
  SELECT RAISE(ABORT, 'MACHINE_DRAFT_IMMUTABLE');
END;

CREATE TRIGGER operation_entity_binding_insert_guard BEFORE INSERT ON operation_entity_binding
WHEN NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id
    AND op.state='requested' AND op.entity_set_hash=NEW.entity_set_hash
    AND ((NEW.identity_selector='source_id' AND NEW.entity_id=op.source_id)
      OR (NEW.identity_selector='candidate_id' AND NEW.entity_id=op.candidate_id)
      OR (NEW.identity_selector='publication_id' AND NEW.entity_id=op.publication_id)
      OR (NEW.identity_selector='public_id' AND NEW.entity_id=op.public_id)
      OR (NEW.identity_selector='control_singleton' AND NEW.entity_id IN ('1','active'))
      OR NEW.identity_selector='bound_child'))
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_INVALID'); END;

CREATE TRIGGER operation_entity_binding_no_delete BEFORE DELETE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;

CREATE TRIGGER operation_entity_binding_no_update BEFORE UPDATE ON operation_entity_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_ENTITY_BINDING_IMMUTABLE'); END;

CREATE TRIGGER operation_fence_binding_insert_guard BEFORE INSERT ON operation_fence_binding
WHEN NEW.version<>1 OR NEW.prechecked_at IS NOT NULL OR NEW.consumed_at IS NOT NULL OR NEW.postchecked_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op JOIN generic_fence_receipt r ON r.fence_receipt_id=NEW.fence_receipt_id
    WHERE op.operation_id=NEW.operation_id AND op.state='requested'
      AND op.required_fence_set_hash=NEW.fence_set_hash
      AND r.scope_kind=NEW.scope_kind AND r.scope_id IS NEW.scope_id AND r.fence_kind=NEW.fence_kind
      AND r.receipt_sha256=NEW.receipt_sha256 AND r.policy_epoch=NEW.policy_epoch
      AND r.recovery_epoch=NEW.recovery_epoch AND r.writer_epoch=NEW.writer_epoch
      AND NEW.policy_epoch=op.policy_epoch AND NEW.recovery_epoch=op.recovery_epoch
      AND NEW.writer_epoch=op.expected_writer_epoch
      AND ((NEW.scope_kind='global' AND NEW.scope_id IS NULL)
        OR (NEW.scope_kind='source' AND NEW.scope_id=op.source_id)
        OR (NEW.scope_kind='candidate' AND NEW.scope_id=op.candidate_id)
        OR (NEW.scope_kind='publication' AND NEW.scope_id=op.publication_id)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_BINDING_INVALID'); END;

CREATE TRIGGER operation_fence_binding_no_delete BEFORE DELETE ON operation_fence_binding
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_BINDING_IMMUTABLE'); END;

CREATE TRIGGER operation_fence_binding_update_guard BEFORE UPDATE ON operation_fence_binding
WHEN NEW.operation_id<>OLD.operation_id OR NEW.fence_receipt_id<>OLD.fence_receipt_id
  OR NEW.scope_kind<>OLD.scope_kind OR NEW.scope_id IS NOT OLD.scope_id OR NEW.fence_kind<>OLD.fence_kind
  OR NEW.required_state<>OLD.required_state OR NEW.receipt_sha256<>OLD.receipt_sha256
  OR NEW.fence_set_hash<>OLD.fence_set_hash OR NEW.policy_epoch<>OLD.policy_epoch
  OR NEW.recovery_epoch<>OLD.recovery_epoch OR NEW.writer_epoch<>OLD.writer_epoch
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.version<>OLD.version+1
  OR NOT ((OLD.prechecked_at IS NULL AND NEW.prechecked_at IS NOT NULL AND NEW.consumed_at=NEW.prechecked_at AND NEW.postchecked_at IS NULL)
    OR (OLD.prechecked_at IS NOT NULL AND OLD.postchecked_at IS NULL AND NEW.prechecked_at=OLD.prechecked_at
      AND NEW.consumed_at=OLD.consumed_at AND NEW.postchecked_at IS NOT NULL))
  OR datetime(COALESCE(NEW.postchecked_at,NEW.prechecked_at)) IS NULL
  OR strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(NEW.postchecked_at,NEW.prechecked_at))<>COALESCE(NEW.postchecked_at,NEW.prechecked_at)
  OR NOT EXISTS(SELECT 1 FROM generic_fence_receipt r WHERE r.fence_receipt_id=NEW.fence_receipt_id
    AND r.receipt_sha256=NEW.receipt_sha256 AND r.scope_kind=NEW.scope_kind AND r.scope_id IS NEW.scope_id
    AND r.fence_kind=NEW.fence_kind AND r.policy_epoch=NEW.policy_epoch AND r.recovery_epoch=NEW.recovery_epoch
    AND r.writer_epoch=NEW.writer_epoch AND r.state<>'unknown'
    AND ((NEW.required_state='clear' AND r.state='clear')
      OR (NEW.required_state='blocked_reconcile_readonly' AND r.state IN ('clear','blocked'))
      OR (NEW.required_state='clear_or_blocked_removal' AND r.state IN ('clear','blocked')))
    AND unixepoch(r.expires_at)>unixepoch(COALESCE(NEW.postchecked_at,NEW.prechecked_at)))
BEGIN SELECT RAISE(ABORT,'OPERATION_FENCE_REREAD_INVALID'); END;

CREATE TRIGGER owner_authorization_handoff_no_delete
BEFORE DELETE ON owner_authorization_handoff BEGIN SELECT RAISE(ABORT,'OWNER_HANDOFF_IMMUTABLE'); END;

CREATE TRIGGER owner_authorization_handoff_update_guard
BEFORE UPDATE ON owner_authorization_handoff
WHEN OLD.consumed_by_operation_id IS NOT NULL
  OR NEW.handoff_id<>OLD.handoff_id OR NEW.owner_process<>OLD.owner_process OR NEW.issuer<>OLD.issuer
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.release_sha256<>OLD.release_sha256
  OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.receipt_sha256<>OLD.receipt_sha256
  OR NEW.verified_at<>OLD.verified_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.consumed_by_operation_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.consumed_by_operation_id AND op.authorization_handoff_id=NEW.handoff_id AND op.state='requested')
BEGIN SELECT RAISE(ABORT,'OWNER_HANDOFF_IMMUTABLE'); END;

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

CREATE TRIGGER projection_delivery_receipt_no_delete
BEFORE DELETE ON projection_delivery_receipt
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_IMMUTABLE');
END;

CREATE TRIGGER projection_delivery_receipt_no_update
BEFORE UPDATE ON projection_delivery_receipt
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_RECEIPT_IMMUTABLE');
END;

CREATE TRIGGER projection_outbox_guard_insert
BEFORE INSERT ON projection_outbox
WHEN NEW.status <> 'pending'
  OR NEW.attempt_count <> 0
  OR NEW.lease_token IS NOT NULL
  OR NEW.lease_expires_at IS NOT NULL
  OR NEW.last_reason_code IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM projection_outbox AS existing
    WHERE existing.delivery_id = NEW.delivery_id
      OR existing.publication_id = NEW.publication_id
      OR existing.idempotency_key = NEW.idempotency_key
      OR existing.reconcile_key = NEW.reconcile_key
      OR (
        existing.snapshot_generation = NEW.snapshot_generation AND
        existing.snapshot_manifest_hash = NEW.snapshot_manifest_hash
      )
  )
  OR json_extract(NEW.task_envelope_json, '$.attempt') IS NOT 0
  OR NOT EXISTS (
  SELECT 1
  FROM publication
  WHERE publication.publication_id = NEW.publication_id
    AND publication.publication_status = 'published'
    AND publication.published_at IS NOT NULL
)
  OR json_extract(NEW.task_envelope_json, '$.deliveryId') IS NOT NEW.delivery_id
  OR json_extract(NEW.task_envelope_json, '$.idempotencyKey') IS NOT NEW.idempotency_key
  OR json_extract(NEW.task_envelope_json, '$.reconcileKey') IS NOT NEW.reconcile_key
  OR json_extract(NEW.task_envelope_json, '$.operationType') IS NOT NEW.operation_type
  OR json_extract(NEW.task_envelope_json, '$.snapshot.snapshotGeneration') IS NOT NEW.snapshot_generation
  OR json_extract(NEW.task_envelope_json, '$.snapshot.snapshotManifestHash') IS NOT NEW.snapshot_manifest_hash
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_INVALID');
END;

CREATE TRIGGER projection_outbox_identity_no_update
BEFORE UPDATE OF publication_id, operation_type, snapshot_generation, snapshot_manifest_hash, idempotency_key, reconcile_key, task_envelope_json, task_envelope_hash, max_attempts, created_at ON projection_outbox
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_IDENTITY_IMMUTABLE');
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

CREATE TRIGGER projection_outbox_no_delete
BEFORE DELETE ON projection_outbox
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_IMMUTABLE');
END;

CREATE TRIGGER projection_outbox_runtime_insert_guard
BEFORE INSERT ON projection_outbox
WHEN NEW.max_attempts <> 3
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_RUNTIME_INVALID');
END;

CREATE TRIGGER projection_outbox_status_transition_guard
BEFORE UPDATE OF status, attempt_count, lease_token, lease_expires_at, last_reason_code ON projection_outbox
WHEN NOT (
  (
    NEW.status = OLD.status AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS OLD.lease_token AND
    NEW.lease_expires_at IS OLD.lease_expires_at AND
    NEW.last_reason_code IS OLD.last_reason_code
  ) OR
  (
    OLD.status IN ('pending', 'retryable_failed') AND
    NEW.status = 'leased' AND
    NEW.attempt_count = OLD.attempt_count + 1 AND
    NEW.attempt_count <= OLD.max_attempts AND
    NEW.lease_token IS NOT NULL AND
    NEW.lease_expires_at IS NOT NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'pending' AND
    NEW.status IN ('retryable_failed', 'cancelled') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'leased' AND
    NEW.status = 'succeeded' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'leased' AND
    NEW.status IN ('retryable_failed', 'reconcile_wait') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'retryable_failed' AND
    NEW.status = 'cancelled' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  ) OR
  (
    OLD.status = 'reconcile_wait' AND
    NEW.status = 'succeeded' AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NULL
  ) OR
  (
    OLD.status = 'reconcile_wait' AND
    NEW.status IN ('retryable_failed', 'terminal_failed') AND
    NEW.attempt_count = OLD.attempt_count AND
    NEW.lease_token IS NULL AND
    NEW.lease_expires_at IS NULL AND
    NEW.last_reason_code IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_OUTBOX_STATE_INVALID');
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

CREATE TRIGGER projection_recovery_anchor_insert_guard BEFORE INSERT ON projection_recovery_anchor
WHEN NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  JOIN internal_control c ON c.singleton_id=1
  WHERE p.entity_kind='projection_pointer' AND p.entity_id='active' AND p.mutation_kind='activate' AND p.consumed_at IS NULL
    AND op.operation_id=NEW.operation_id AND op.state='authorized'
    AND NEW.writer_epoch=c.writer_epoch AND NEW.recovery_epoch=c.recovery_epoch
    AND NEW.writer_authority_receipt_sha256=c.writer_authority_receipt_sha256)
BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_AUTHORITY_INVALID'); END;

CREATE TRIGGER projection_recovery_anchor_no_delete BEFORE DELETE ON projection_recovery_anchor BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_IMMUTABLE'); END;

CREATE TRIGGER projection_recovery_anchor_update_guard BEFORE UPDATE ON projection_recovery_anchor
WHEN NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
  JOIN internal_control c ON c.singleton_id=1
  WHERE p.entity_kind='projection_pointer' AND p.entity_id='active' AND p.mutation_kind='activate' AND p.consumed_at IS NULL
    AND op.operation_id=NEW.operation_id AND op.state='authorized'
    AND NEW.writer_epoch=c.writer_epoch AND NEW.recovery_epoch=c.recovery_epoch
    AND NEW.writer_authority_receipt_sha256=c.writer_authority_receipt_sha256)
BEGIN SELECT RAISE(ABORT,'PROJECTION_POINTER_AUTHORITY_INVALID'); END;

CREATE TRIGGER publication_guard_insert
BEFORE INSERT ON publication
WHEN NEW.publication_status <> 'queued'
  OR NEW.published_at IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM publication AS existing
    WHERE existing.publication_id = NEW.publication_id
      OR existing.decision_id = NEW.decision_id
      OR existing.bundle_id = NEW.bundle_id
      OR existing.public_id = NEW.public_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM review_decision AS decision
    JOIN review_bundle AS bundle ON bundle.bundle_id = decision.bundle_id
    WHERE decision.decision_id = NEW.decision_id
      AND decision.bundle_id = NEW.bundle_id
      AND decision.decision = 'approved'
      AND decision.approved_bundle_hash = bundle.bundle_hash
      AND NEW.approved_bundle_hash = bundle.bundle_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_APPROVAL_INVALID');
END;

CREATE TRIGGER publication_identity_no_update
BEFORE UPDATE OF decision_id, bundle_id, public_id, approved_bundle_hash, publish_generation, created_at ON publication
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER publication_no_delete
BEFORE DELETE ON publication
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_IMMUTABLE');
END;

CREATE TRIGGER publication_published_at_guard
BEFORE UPDATE OF published_at ON publication
WHEN NOT (
  OLD.publication_status = 'queued' AND
  OLD.published_at IS NULL AND
  NEW.publication_status = 'published' AND
  NEW.published_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_PUBLISHED_AT_IMMUTABLE');
END;

CREATE TRIGGER publication_status_transition_guard
BEFORE UPDATE OF publication_status ON publication
WHEN NOT (
  NEW.publication_status = OLD.publication_status OR
  (OLD.publication_status = 'queued' AND NEW.publication_status IN ('published', 'reconcile_wait', 'terminal_failed', 'emergency_stopped', 'superseded')) OR
  (OLD.publication_status = 'published' AND NEW.publication_status IN ('reconcile_wait', 'terminal_failed', 'emergency_stopped')) OR
  (OLD.publication_status = 'reconcile_wait' AND NEW.publication_status IN ('published', 'terminal_failed', 'emergency_stopped'))
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLICATION_STATE_INVALID');
END;

CREATE TRIGGER published_projection_guard_insert
BEFORE INSERT ON published_projection
WHEN NOT EXISTS (
  SELECT 1
  FROM publication
  WHERE publication.publication_id = NEW.publication_id
    AND publication.bundle_id = NEW.bundle_id
    AND publication.public_id = NEW.public_id
    AND publication.publish_generation = NEW.publish_generation
    AND publication.publication_status = 'published'
    AND publication.published_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECTION_PUBLICATION_INVALID');
END;

CREATE TRIGGER published_projection_no_delete
BEFORE DELETE ON published_projection
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_PROJECTION_IMMUTABLE');
END;

CREATE TRIGGER published_projection_no_update
BEFORE UPDATE ON published_projection
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_PROJECTION_IMMUTABLE');
END;

CREATE TRIGGER quick_launch_authority_audit_no_delete BEFORE DELETE ON quick_launch_authority_audit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER quick_launch_authority_audit_no_update BEFORE UPDATE ON quick_launch_authority_audit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER quick_launch_authority_no_delete BEFORE DELETE ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;

CREATE TRIGGER quick_launch_authority_no_insert BEFORE INSERT ON quick_launch_authority_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_FIXED_SET'); END;

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

CREATE TRIGGER quick_launch_authority_permit_no_delete BEFORE DELETE ON quick_launch_authority_permit_v2
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER quick_launch_authority_permit_update_guard BEFORE UPDATE ON quick_launch_authority_permit_v2
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.capability_id<>OLD.capability_id OR NEW.action<>OLD.action OR NEW.expected_version<>OLD.expected_version
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.request_hash<>OLD.request_hash
  OR NEW.authority_receipt_sha256<>OLD.authority_receipt_sha256 OR NEW.created_at<>OLD.created_at
  OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'QUICK_LAUNCH_AUTHORITY_PERMIT_IMMUTABLE'); END;

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

CREATE TRIGGER review_bundle_guard_insert
BEFORE INSERT ON review_bundle
WHEN NOT EXISTS (
  SELECT 1
  FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
    AND candidate.editor_based_on_source_revision = NEW.source_revision
    AND candidate.editor_title = json_extract(NEW.public_payload_json, '$.titleZh')
    AND candidate.editor_excerpt = json_extract(NEW.public_payload_json, '$.summaryZh')
    AND COALESCE(candidate.editor_notes, '') = NEW.editor_notes
    AND json_extract(NEW.public_payload_json, '$.candidateId') = candidate.candidate_id
    AND json_extract(NEW.public_payload_json, '$.sourceId') = candidate.source_id
    AND json_extract(NEW.public_payload_json, '$.sourceRevision') = candidate.source_revision
    AND json_extract(NEW.public_payload_json, '$.sourcePayloadHash') = candidate.source_payload_hash
    AND json_extract(NEW.public_payload_json, '$.canonicalUrl') = candidate.canonical_url
    AND ((EXISTS(SELECT 1 FROM source s WHERE s.source_id=candidate.source_id AND s.source_kind='rss')
      AND json_extract(NEW.public_payload_json, '$.sourceTitle') = candidate.title)
      OR (EXISTS(SELECT 1 FROM source s JOIN x_page_candidate_capture_v1 capture ON capture.source_id=s.source_id
        WHERE s.source_kind='x_page' AND s.source_id=candidate.source_id AND capture.candidate_id=candidate.candidate_id
        AND capture.source_revision=candidate.source_revision AND capture.source_version_hash=candidate.source_payload_hash
        AND capture.complete_text=json_extract(NEW.public_payload_json,'$.sourceTitle')
        AND capture.evidence_sha256=json_extract(NEW.public_payload_json,'$.xCaptureSha256'))
       AND json_extract(NEW.public_payload_json,'$.contentType')='driver_social'
       AND json_array_length(json_extract(NEW.public_payload_json,'$.media'))=0))
    AND json_extract(NEW.public_payload_json, '$.sourcePublishedAt') = candidate.published_at
    AND (
      (
        json_array_length(json_extract(NEW.public_payload_json, '$.media')) = 0 AND
        NOT EXISTS (
          SELECT 1 FROM rss_media_candidate AS media
          WHERE media.candidate_id = candidate.candidate_id
            AND media.source_revision = candidate.source_revision
            AND media.source_payload_hash = candidate.source_payload_hash
        )
      ) OR (
        json_array_length(json_extract(NEW.public_payload_json, '$.media')) = 1 AND
        EXISTS (
          SELECT 1 FROM rss_media_candidate AS media
          WHERE media.candidate_id = candidate.candidate_id
            AND media.source_revision = candidate.source_revision
            AND media.source_payload_hash = candidate.source_payload_hash
            AND json_extract(NEW.public_payload_json, '$.media[0].kind') = 'source_image'
            AND json_extract(NEW.public_payload_json, '$.media[0].url') = media.media_url
            AND json_extract(NEW.public_payload_json, '$.media[0].mimeType') = media.media_type
            AND json_extract(NEW.public_payload_json, '$.media[0].declaredBytes') = media.declared_bytes
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_SOURCE_STALE');
END;

CREATE TRIGGER review_bundle_no_delete
BEFORE DELETE ON review_bundle
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_IMMUTABLE');
END;

CREATE TRIGGER review_bundle_no_update
BEFORE UPDATE ON review_bundle
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_IMMUTABLE');
END;

CREATE TRIGGER review_decision_guard_insert
BEFORE INSERT ON review_decision
WHEN NOT EXISTS (
  SELECT 1
  FROM review_bundle AS bundle
  JOIN pending_review_candidate AS candidate
    ON candidate.candidate_id = bundle.candidate_id
  WHERE bundle.bundle_id = NEW.bundle_id
    AND bundle.source_revision = candidate.source_revision
    AND bundle.source_revision = candidate.editor_based_on_source_revision
    AND bundle.source_payload_hash = candidate.source_payload_hash
    AND NOT EXISTS (
      SELECT 1 FROM review_bundle AS newer
      WHERE newer.candidate_id = bundle.candidate_id
        AND newer.bundle_revision > bundle.bundle_revision
    )
    AND (
      (NEW.decision = 'approved' AND NEW.approved_bundle_hash = bundle.bundle_hash) OR
      (NEW.decision = 'rejected' AND NEW.approved_bundle_hash IS NULL)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_BUNDLE_STALE');
END;

CREATE TRIGGER review_decision_no_delete
BEFORE DELETE ON review_decision
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISION_IMMUTABLE');
END;

CREATE TRIGGER review_decision_no_update
BEFORE UPDATE ON review_decision
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISION_IMMUTABLE');
END;

CREATE TRIGGER route_registry_no_delete BEFORE DELETE ON route_registry BEGIN SELECT RAISE(ABORT,'ROUTE_REGISTRY_IMMUTABLE'); END;

CREATE TRIGGER route_registry_no_update BEFORE UPDATE ON route_registry BEGIN SELECT RAISE(ABORT,'ROUTE_REGISTRY_IMMUTABLE'); END;

CREATE TRIGGER rss_automatic_fence_consumer_guard_v1 BEFORE INSERT ON operation_fence_binding
WHEN EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id
 AND op.owner_process IN ('automatic_reviewer','automatic_publisher') AND op.policy_id NOT LIKE 'p-x-page-%')
 AND NOT EXISTS(SELECT 1 FROM rss_automatic_fence_current_v1 f JOIN internal_operation op ON op.operation_id=NEW.operation_id
 WHERE f.fence_receipt_id=NEW.fence_receipt_id AND f.candidate_id=op.candidate_id AND f.source_id=op.source_id)
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_FENCE_CURRENT_REQUIRED'); END;

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

CREATE TRIGGER rss_automatic_source_binding_no_delete BEFORE DELETE ON rss_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_IMMUTABLE'); END;

CREATE TRIGGER rss_automatic_source_binding_no_update BEFORE UPDATE ON rss_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'RSS_AUTO_SOURCE_BINDING_IMMUTABLE'); END;

CREATE TRIGGER rss_media_candidate_insert_guard
BEFORE INSERT ON rss_media_candidate
WHEN EXISTS (
  SELECT 1 FROM rss_media_candidate AS existing
  WHERE existing.candidate_id = NEW.candidate_id
    AND (existing.source_revision = NEW.source_revision OR existing.source_payload_hash = NEW.source_payload_hash)
) OR NOT EXISTS (
  SELECT 1 FROM pending_review_candidate AS candidate
  WHERE candidate.candidate_id = NEW.candidate_id
    AND candidate.source_revision = NEW.source_revision
    AND candidate.source_payload_hash = NEW.source_payload_hash
)
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IDENTITY_INVALID');
END;

CREATE TRIGGER rss_media_candidate_no_delete
BEFORE DELETE ON rss_media_candidate
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IMMUTABLE');
END;

CREATE TRIGGER rss_media_candidate_no_update
BEFORE UPDATE ON rss_media_candidate
BEGIN
  SELECT RAISE(ABORT, 'RSS_MEDIA_IMMUTABLE');
END;

CREATE TRIGGER source_registry_health_no_delete BEFORE DELETE ON source_registry_health_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HEALTH_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_health_no_update BEFORE UPDATE ON source_registry_health_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HEALTH_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_health_x_zero_guard BEFORE INSERT ON source_registry_health_v1
WHEN NEW.external_calls<>0 AND EXISTS(SELECT 1 FROM source_registry_v1 s WHERE s.source_id=NEW.source_id AND s.source_kind='x_manual')
BEGIN SELECT RAISE(ABORT,'X_AUTOMATION_DISABLED'); END;

CREATE TRIGGER source_registry_history_no_delete BEFORE DELETE ON source_registry_history_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_history_no_update BEFORE UPDATE ON source_registry_history_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_HISTORY_APPEND_ONLY'); END;

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

CREATE TRIGGER source_registry_migration_identity_no_delete BEFORE DELETE ON source_registry_migration_identity_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MIGRATION_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER source_registry_migration_identity_no_update BEFORE UPDATE ON source_registry_migration_identity_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MIGRATION_IDENTITY_IMMUTABLE'); END;

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
      OR (NEW.action='disable' AND op.operation_kind='source_update' AND op.policy_id='p-x-page-source-update-paused' AND op.phase='paused' AND EXISTS(SELECT 1 FROM source_registry_v1 x WHERE x.source_id=NEW.source_id AND x.source_kind='x_page'))
      OR (NEW.action='retire' AND op.operation_kind='source_delete' AND op.policy_id='p-source-delete-paused' AND op.phase='paused'))
)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_INVALID'); END;

CREATE TRIGGER source_registry_mutation_permit_no_delete BEFORE DELETE ON source_registry_mutation_permit_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER source_registry_mutation_permit_update_guard BEFORE UPDATE ON source_registry_mutation_permit_v1
WHEN OLD.consumed_at IS NOT NULL OR NEW.permit_id<>OLD.permit_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.source_id<>OLD.source_id OR NEW.action<>OLD.action OR NEW.expected_revision<>OLD.expected_revision
  OR NEW.request_hash<>OLD.request_hash OR NEW.reason_code<>OLD.reason_code OR NEW.authorization_ref IS NOT OLD.authorization_ref
  OR NEW.one_time_nonce<>OLD.one_time_nonce OR NEW.created_at<>OLD.created_at OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_MUTATION_PERMIT_IMMUTABLE'); END;

CREATE TRIGGER source_registry_no_delete BEFORE DELETE ON source_registry_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RETIRE_IS_STATE_TRANSITION'); END;

CREATE TRIGGER source_registry_outbox_insert_guard BEFORE INSERT ON source_registry_outbox_v1
WHEN NOT EXISTS(SELECT 1 FROM source_registry_v1 s JOIN source_registry_mutation_permit_v1 p ON p.operation_id=NEW.operation_id
  WHERE s.source_id=NEW.source_id AND s.current_operation_id=NEW.operation_id AND s.revision=NEW.source_revision
    AND s.enabled=1 AND p.source_id=s.source_id AND p.action='enable' AND p.consumed_at=NEW.created_at
    AND NEW.state='pending' AND NEW.attempt_count=0 AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL
    AND NEW.payload_sha256=s.current_request_hash AND NEW.updated_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_INSERT_INVALID'); END;

CREATE TRIGGER source_registry_outbox_no_delete BEFORE DELETE ON source_registry_outbox_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_APPEND_ONLY'); END;

CREATE TRIGGER source_registry_outbox_transition_guard BEFORE UPDATE ON source_registry_outbox_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_OUTBOX_AUTHORITY_EXTENSION_REQUIRED'); END;

CREATE TRIGGER source_registry_rss_config_no_delete BEFORE DELETE ON source_registry_rss_config_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_CONFIG_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_no_update BEFORE UPDATE ON source_registry_rss_config_v1
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_CONFIG_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_v2_identity_no_delete BEFORE DELETE ON source_registry_rss_config_v2_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_v2_identity_no_update BEFORE UPDATE ON source_registry_rss_config_v2_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_config_v2_insert_guard BEFORE INSERT ON source_registry_rss_config_v2
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V2_INSERT_CLOSED'); END;

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

CREATE TRIGGER source_registry_rss_config_v3_insert_guard BEFORE INSERT ON source_registry_rss_config_v3
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_CONFIG_V3_INSERT_CLOSED'); END;

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

CREATE TRIGGER source_registry_rss_skysports_identity_no_delete BEFORE DELETE ON source_registry_rss_skysports_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_SKYSPORTS_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER source_registry_rss_skysports_identity_no_update BEFORE UPDATE ON source_registry_rss_skysports_identity
BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_RSS_SKYSPORTS_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER source_registry_update_effects AFTER UPDATE ON source_registry_v1
WHEN OLD.source_kind<>'x_page' OR EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.current_operation_id AND op.policy_id='p-x-page-source-update-paused')
BEGIN
  UPDATE source SET enabled=0,stop_epoch=stop_epoch+1,last_reason_code='X_PAGE_SOURCE_DISABLED' WHERE source_id=NEW.source_id AND source_kind='x_page';
  UPDATE x_page_source_config_v1 SET source_revision=NEW.revision WHERE source_id=NEW.source_id AND NEW.source_kind='x_page';
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
WHEN OLD.source_kind<>'x_page' AND (NEW.source_id<>OLD.source_id OR NEW.display_name<>OLD.display_name OR NEW.canonical_feed_url IS NOT OLD.canonical_feed_url
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
) BEGIN SELECT RAISE(ABORT,'SOURCE_REGISTRY_TRANSITION_INVALID'); END;

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

CREATE TRIGGER x_manual_audit_no_delete
BEFORE DELETE ON x_manual_audit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_AUDIT_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_audit_no_update
BEFORE UPDATE ON x_manual_audit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_AUDIT_APPEND_ONLY');
END;

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

CREATE TRIGGER x_manual_operation_no_delete
BEFORE DELETE ON x_manual_operation
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_OPERATION_APPEND_ONLY');
END;

CREATE TRIGGER x_manual_operation_no_update
BEFORE UPDATE ON x_manual_operation
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_OPERATION_IMMUTABLE');
END;

CREATE TRIGGER x_manual_source_registry_immutable_delete
BEFORE DELETE ON x_manual_source_registry
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SOURCE_REGISTRY_IMMUTABLE');
END;

CREATE TRIGGER x_manual_source_registry_immutable_update
BEFORE UPDATE ON x_manual_source_registry
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SOURCE_REGISTRY_IMMUTABLE');
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

CREATE TRIGGER x_manual_submission_no_delete
BEFORE DELETE ON x_manual_submission
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_SUBMISSION_APPEND_ONLY');
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

CREATE TRIGGER x_manual_write_permit_no_delete
BEFORE DELETE ON x_manual_write_permit
BEGIN
  SELECT RAISE(ABORT, 'X_MANUAL_WRITE_PERMIT_APPEND_ONLY');
END;

CREATE VIEW authorized_gateway_write_permit_v1 AS
SELECT p.* FROM gateway_write_permit p JOIN internal_operation op ON op.operation_id=p.operation_id
WHERE op.state='authorized';

CREATE VIEW bilingual_lineage_effective_safety_v1 AS
SELECT decision.*
FROM bilingual_lineage_safety_decision_v1 decision
JOIN source_registry_v1 registry ON registry.source_id = decision.source_id
JOIN source_registry_rss_config_v1 config ON config.source_id = decision.source_id
JOIN internal_control control ON control.singleton_id = 1
WHERE NOT EXISTS (
  SELECT 1 FROM bilingual_lineage_safety_decision_v1 later
  WHERE later.candidate_id = decision.candidate_id AND later.decision_seq > decision.decision_seq
)
AND registry.revision = decision.source_registry_revision
AND registry.identity_sha256 = decision.source_identity_sha256
AND registry.enabled = 1 AND registry.lifecycle_status = 'active'
AND registry.source_kind = 'rss' AND registry.collection_mode = 'rss'
AND registry.normalization_status = 'valid' AND registry.dedup_status IN ('unique', 'linked_existing')
AND registry.adapter_status = 'ready'
AND registry.adapter_authorization_status = 'valid' AND registry.platform_allowed = 'allowed'
AND registry.authorization_expires_at IS decision.source_authorization_expires_at
AND registry.source_stop_status = 'clear'
AND registry.source_config_epoch = decision.source_config_epoch
AND registry.source_safety_epoch = decision.source_safety_epoch
AND registry.authorization_version = decision.authorization_version
AND registry.policy_epoch = decision.policy_epoch
AND registry.recovery_epoch = decision.recovery_epoch
AND config.source_revision = decision.source_config_revision
AND config.authorization_receipt_sha256 = decision.source_authorization_receipt_sha256
AND config.source_policy_sha256 = decision.source_policy_sha256
AND control.source_config_epoch = decision.control_source_config_epoch
AND control.source_safety_epoch = decision.control_source_safety_epoch
AND control.authorization_version = decision.control_authorization_version
AND control.policy_epoch = decision.control_policy_epoch
AND control.recovery_epoch = decision.control_recovery_epoch
AND control.writer_epoch = decision.writer_epoch;

CREATE VIEW internal_operation_current_v1 AS
SELECT operation_id,idempotency_key,operation_kind,owner_process,state,version,
       source_id,candidate_id,publication_id,public_id,phase,attempt,egress_class,
       source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,
       source_stop_epoch,global_stop_state,emergency_stop_state,recovery_state,
       deletion_fence_state,publication_fence_state,expected_entity_hash,entity_set_hash,
       required_fence_set_hash,expected_writer_epoch,reason_code,created_at,updated_at
FROM internal_operation;

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

CREATE VIEW valid_backup_recovery_point_v1 AS
SELECT * FROM backup_recovery_point
WHERE off_host_verified=1 AND encrypted=1 AND rpo_seconds<=900
  AND restore_drill_state='verified' AND restore_duration_seconds<=14400
  AND datetime(recovery_point_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',recovery_point_at)=recovery_point_at
  AND date(substr(recovery_point_at,1,10),'+0 days')=substr(recovery_point_at,1,10)
  AND datetime(completed_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',completed_at)=completed_at
  AND date(substr(completed_at,1,10),'+0 days')=substr(completed_at,1,10)
  AND unixepoch(completed_at)>=unixepoch(recovery_point_at)
  AND datetime(incident_declared_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',incident_declared_at)=incident_declared_at
  AND date(substr(incident_declared_at,1,10),'+0 days')=substr(incident_declared_at,1,10)
  AND datetime(admin_available_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',admin_available_at)=admin_available_at
  AND date(substr(admin_available_at,1,10),'+0 days')=substr(admin_available_at,1,10)
  AND datetime(public_available_at) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ',public_available_at)=public_available_at
  AND date(substr(public_available_at,1,10),'+0 days')=substr(public_available_at,1,10)
  AND max(unixepoch(admin_available_at),unixepoch(public_available_at))-unixepoch(incident_declared_at)<=14400
  AND drill_isolated=1 AND drill_decryption_verified=1 AND drill_hash_verified=1
  AND drill_integrity_verified=1 AND drill_fk_verified=1 AND drill_schema_verified=1
  AND drill_bootable=1 AND drill_business_point_verified=1 AND drill_public_pointer_verified=1;

CREATE TABLE x_page_source_admission_v1(
 admission_id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL REFERENCES source_registry_v1(source_id),
 registry_revision INTEGER NOT NULL CHECK(registry_revision>=3),
 operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id),
 producer_id TEXT NOT NULL,key_id TEXT NOT NULL,host_id TEXT NOT NULL,
 deployment_manifest_sha256 TEXT NOT NULL CHECK(length(deployment_manifest_sha256)=64),
 public_key_sha256 TEXT NOT NULL CHECK(length(public_key_sha256)=64),
 adapter_sha256 TEXT NOT NULL CHECK(length(adapter_sha256)=64),
 producer_admission_receipt_sha256 TEXT NOT NULL CHECK(length(producer_admission_receipt_sha256)=64),
 authorization_receipt_sha256 TEXT NOT NULL CHECK(length(authorization_receipt_sha256)=64),
 source_policy_sha256 TEXT NOT NULL CHECK(length(source_policy_sha256)=64),
 capture_sha256 TEXT NOT NULL CHECK(length(capture_sha256)=64),
 capture_proof_sha256 TEXT NOT NULL CHECK(length(capture_proof_sha256)=64),
 authorized_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
 admission_sha256 TEXT NOT NULL CHECK(length(admission_sha256)=64),
 admitted_at TEXT NOT NULL,
 UNIQUE(source_id,registry_revision)
) STRICT;
CREATE TABLE x_page_source_config_v1(
 source_id TEXT PRIMARY KEY REFERENCES source_registry_v1(source_id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=2),
 canonical_handle TEXT NOT NULL UNIQUE,
 canonical_page_url TEXT NOT NULL UNIQUE,
 identity_sha256 TEXT NOT NULL CHECK(length(identity_sha256)=64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'),
 selection_sha256 TEXT NOT NULL,
 schedule_seconds INTEGER NOT NULL CHECK(schedule_seconds=900),
 concurrency INTEGER NOT NULL CHECK(concurrency=1),
 adapter_sha256 TEXT,
 authorization_receipt_sha256 TEXT,
 authorization_expires_at TEXT,
 source_policy_sha256 TEXT,
 rights_status TEXT NOT NULL CHECK(rights_status IN('unknown','clear')),
 media_policy TEXT NOT NULL CHECK(media_policy='blocked'),
 evidence_class TEXT NOT NULL CHECK(evidence_class IN('admission_required','producer_signed_visible_capture')),
 admission_id TEXT REFERENCES x_page_source_admission_v1(admission_id),
 CHECK((evidence_class='admission_required' AND adapter_sha256 IS NULL AND authorization_receipt_sha256 IS NULL AND authorization_expires_at IS NULL AND source_policy_sha256 IS NULL AND rights_status='unknown' AND admission_id IS NULL)
  OR (evidence_class='producer_signed_visible_capture' AND length(adapter_sha256)=64 AND length(authorization_receipt_sha256)=64 AND authorization_expires_at IS NOT NULL AND length(source_policy_sha256)=64 AND rights_status='clear' AND admission_id IS NOT NULL))
) STRICT;
INSERT INTO x_page_source_config_v1 SELECT s.source_id,r.revision,s.canonical_handle,'https://x.com/'||s.canonical_handle,s.identity_sha256,m.selection_sha256,900,1,NULL,NULL,NULL,NULL,'unknown','blocked','admission_required',NULL
FROM migration_0017_source s JOIN source_registry_v1 r ON r.source_id=s.source_id CROSS JOIN migration_0017_manifest m;
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
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
 observed_at TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id),
 UNIQUE(candidate_id,source_revision),UNIQUE(candidate_id,source_version_hash)
) STRICT;
CREATE INDEX x_page_status_capture_idx ON x_page_candidate_capture_v1(status_id,source_revision);
CREATE TABLE x_page_producer_receipt_v1(
 receipt_entity_id TEXT PRIMARY KEY,
 admission_id TEXT NOT NULL REFERENCES x_page_source_admission_v1(admission_id),
 producer_id TEXT NOT NULL,receipt_id TEXT NOT NULL,
 capture_sha256 TEXT NOT NULL CHECK(length(capture_sha256)=64),
 capture_proof_sha256 TEXT NOT NULL CHECK(length(capture_proof_sha256)=64),
 source_id TEXT NOT NULL REFERENCES x_page_source_config_v1(source_id),
 observed_source_id TEXT NOT NULL REFERENCES x_page_source_config_v1(source_id),
 captured_source_version_hash TEXT NOT NULL CHECK(length(captured_source_version_hash)=64),
 candidate_id TEXT NOT NULL REFERENCES pending_review_candidate(candidate_id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 operation_id TEXT NOT NULL UNIQUE REFERENCES internal_operation(operation_id),
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
 receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64),
 accepted_at TEXT NOT NULL,
 UNIQUE(producer_id,receipt_id)
) STRICT;
CREATE TABLE x_page_admission_identity_v1(
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 predecessor_schema_sha256 TEXT NOT NULL,target_schema_sha256 TEXT NOT NULL,migration_sha256 TEXT NOT NULL,
 selection_sha256 TEXT NOT NULL,preserved_history_sha256 TEXT NOT NULL,applied_at TEXT NOT NULL
) STRICT;
INSERT INTO x_page_admission_identity_v1 SELECT 1,predecessor_schema_sha256,target_schema_sha256,migration_sha256,selection_sha256,preserved_history_sha256,applied_at FROM migration_0017_manifest;
CREATE TRIGGER x_page_config_update_guard BEFORE UPDATE ON x_page_source_config_v1
WHEN NEW.source_id<>OLD.source_id OR NEW.canonical_handle<>OLD.canonical_handle OR NEW.canonical_page_url<>OLD.canonical_page_url
 OR NEW.identity_sha256<>OLD.identity_sha256 OR NEW.selection_sha256<>OLD.selection_sha256
 OR NEW.source_revision<>OLD.source_revision+1 OR NEW.schedule_seconds<>OLD.schedule_seconds OR NEW.concurrency<>OLD.concurrency
 OR NEW.evidence_class<>'producer_signed_visible_capture' OR NEW.rights_status<>'clear' OR NEW.media_policy<>'blocked'
 OR (NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN x_page_source_admission_v1 a ON a.operation_id=op.operation_id AND a.admission_id=NEW.admission_id
 WHERE p.entity_kind='x_page_source_config' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-source-admit-paused' AND op.source_id=OLD.source_id
 AND a.source_id=OLD.source_id AND a.registry_revision=NEW.source_revision AND a.adapter_sha256=NEW.adapter_sha256
 AND a.authorization_receipt_sha256=NEW.authorization_receipt_sha256 AND a.source_policy_sha256=NEW.source_policy_sha256
 AND a.expires_at=NEW.authorization_expires_at)
 AND NOT EXISTS(SELECT 1 FROM source_registry_mutation_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id JOIN source_registry_v1 r ON r.current_operation_id=op.operation_id
 WHERE op.policy_id='p-x-page-source-update-paused' AND op.state='authorized' AND op.owner_process='admin_http' AND p.action='disable' AND p.consumed_at IS NULL
 AND p.source_id=OLD.source_id AND p.expected_revision=OLD.source_revision AND r.source_id=OLD.source_id AND r.enabled=0 AND r.revision=NEW.source_revision
 AND NEW.adapter_sha256 IS OLD.adapter_sha256 AND NEW.authorization_receipt_sha256 IS OLD.authorization_receipt_sha256 AND NEW.authorization_expires_at IS OLD.authorization_expires_at
 AND NEW.source_policy_sha256 IS OLD.source_policy_sha256 AND NEW.admission_id IS OLD.admission_id))
BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_CONFIG_INVALID'); END;
CREATE TRIGGER x_page_registry_update_guard BEFORE UPDATE ON source_registry_v1 WHEN OLD.source_kind='x_page' AND NOT EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.current_operation_id AND op.policy_id='p-x-page-source-update-paused') AND (
 NEW.source_id<>OLD.source_id OR NEW.display_name<>OLD.display_name OR NEW.canonical_feed_url IS NOT OLD.canonical_feed_url
 OR NEW.site_url<>OLD.site_url OR NEW.source_kind<>OLD.source_kind OR NEW.collection_mode<>OLD.collection_mode
 OR NEW.identity_sha256<>OLD.identity_sha256 OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
 OR NEW.enabled<>1 OR NEW.lifecycle_status<>'active' OR NEW.collection_onboarding_status<>'active'
 OR NEW.canonical_url_valid<>1 OR NEW.normalization_status<>'valid' OR NEW.dedup_status<>'unique'
 OR NEW.identity_status<>'verified' OR NEW.relevance_status<>'qualified' OR NEW.monitorability<>'monitorable'
 OR NEW.adapter_status<>'ready' OR NEW.adapter_authorization_status<>'valid' OR NEW.platform_allowed<>'allowed' OR NEW.source_stop_status<>'clear'
 OR NEW.source_config_epoch<>OLD.source_config_epoch+1 OR NEW.source_safety_epoch<>OLD.source_safety_epoch+1
 OR NEW.authorization_version<>OLD.authorization_version+1 OR NEW.policy_epoch<>OLD.policy_epoch OR NEW.recovery_epoch<>OLD.recovery_epoch
 OR NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN x_page_source_admission_v1 a ON a.operation_id=op.operation_id JOIN x_page_source_config_v1 cfg ON cfg.admission_id=a.admission_id
 WHERE p.entity_kind='x_page_source_registry' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-source-admit-paused' AND op.source_id=OLD.source_id AND op.request_hash=NEW.current_request_hash
 AND NEW.current_operation_id=op.operation_id AND a.source_id=OLD.source_id AND a.registry_revision=NEW.revision
 AND a.admitted_at=NEW.updated_at AND cfg.source_revision=NEW.revision AND cfg.authorization_expires_at=NEW.authorization_expires_at))
BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_REGISTRY_INVALID'); END;
CREATE TRIGGER x_page_registry_stop_guard BEFORE UPDATE ON source_registry_v1
WHEN OLD.source_kind='x_page' AND EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.current_operation_id AND op.policy_id='p-x-page-source-update-paused') AND (
 NEW.source_id<>OLD.source_id OR NEW.display_name<>OLD.display_name OR NEW.canonical_feed_url IS NOT OLD.canonical_feed_url
 OR NEW.site_url<>OLD.site_url OR NEW.source_kind<>OLD.source_kind OR NEW.collection_mode<>OLD.collection_mode
 OR NEW.identity_sha256<>OLD.identity_sha256 OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
 OR OLD.enabled<>1 OR OLD.lifecycle_status<>'active' OR OLD.collection_onboarding_status<>'active'
 OR NEW.enabled<>0 OR NEW.lifecycle_status<>'paused' OR NEW.collection_onboarding_status<>'stopped' OR NEW.source_stop_status<>'manual'
 OR NEW.canonical_url_valid<>OLD.canonical_url_valid OR NEW.normalization_status<>OLD.normalization_status OR NEW.dedup_status<>OLD.dedup_status
 OR NEW.identity_status<>OLD.identity_status OR NEW.relevance_status<>OLD.relevance_status OR NEW.monitorability<>OLD.monitorability
 OR NEW.adapter_status<>OLD.adapter_status OR NEW.adapter_authorization_status<>OLD.adapter_authorization_status OR NEW.platform_allowed<>OLD.platform_allowed
 OR NEW.authorization_expires_at IS NOT OLD.authorization_expires_at
 OR NEW.source_config_epoch<>OLD.source_config_epoch+1 OR NEW.source_safety_epoch<>OLD.source_safety_epoch+1
 OR NEW.authorization_version<>OLD.authorization_version+1 OR NEW.policy_epoch<>OLD.policy_epoch OR NEW.recovery_epoch<>OLD.recovery_epoch
 OR NOT EXISTS(SELECT 1 FROM source_registry_mutation_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
 WHERE p.operation_id=NEW.current_operation_id AND p.source_id=OLD.source_id AND p.expected_revision=OLD.revision AND p.action='disable' AND p.consumed_at IS NULL
 AND p.request_hash=NEW.current_request_hash AND op.request_hash=p.request_hash AND op.policy_id='p-x-page-source-update-paused'
 AND op.state='authorized' AND op.owner_process='admin_http' AND op.operation_kind='source_update' AND op.updated_at=p.created_at
 AND h.consumed_by_operation_id=op.operation_id AND h.expires_at>NEW.updated_at AND NEW.updated_at=p.created_at))
BEGIN SELECT RAISE(ABORT,'X_PAGE_SOURCE_STOP_INVALID'); END;
CREATE TRIGGER x_page_source_update_guard BEFORE UPDATE ON source WHEN OLD.source_kind='x_page' AND (
 NEW.source_id<>OLD.source_id OR NEW.source_kind<>OLD.source_kind OR NEW.feed_url IS NOT OLD.feed_url
 OR NEW.stop_epoch<>OLD.stop_epoch+1 OR NEW.etag IS NOT OLD.etag OR NEW.last_modified IS NOT OLD.last_modified
 OR NEW.last_attempt_at IS NOT OLD.last_attempt_at OR NEW.last_success_at IS NOT OLD.last_success_at OR NEW.next_eligible_at IS NOT OLD.next_eligible_at
 OR NOT (
 (NEW.enabled=1 AND NEW.last_reason_code='X_PAGE_SOURCE_ADMITTED' AND EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN source_registry_v1 r ON r.current_operation_id=op.operation_id
 WHERE p.entity_kind='source' AND p.entity_id=OLD.source_id AND p.mutation_kind='update' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-source-admit-paused' AND op.source_id=OLD.source_id AND r.source_id=OLD.source_id AND r.enabled=1))
 OR (NEW.enabled=0 AND NEW.last_reason_code='X_PAGE_SOURCE_DISABLED' AND EXISTS(SELECT 1 FROM source_registry_mutation_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id JOIN source_registry_v1 r ON r.current_operation_id=op.operation_id
 WHERE op.policy_id='p-x-page-source-update-paused' AND op.state='authorized' AND op.owner_process='admin_http' AND p.action='disable' AND p.consumed_at IS NULL
 AND p.source_id=OLD.source_id AND r.source_id=OLD.source_id AND r.enabled=0 AND r.source_stop_status='manual' AND r.revision=p.expected_revision+1))))
BEGIN SELECT RAISE(ABORT,'X_PAGE_ADMISSION_SOURCE_INVALID'); END;
CREATE TRIGGER x_page_capture_insert_guard BEFORE INSERT ON x_page_candidate_capture_v1
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN pending_review_candidate c ON c.candidate_id=NEW.candidate_id
 WHERE p.entity_kind='x_page_capture' AND p.entity_id=NEW.capture_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-trusted-import-live' AND op.operation_id=NEW.operation_id AND op.source_id=NEW.source_id AND op.candidate_id=NEW.candidate_id
 AND c.source_id=NEW.source_id AND c.source_revision=NEW.source_revision AND c.source_payload_hash=NEW.source_version_hash
 AND c.external_id=NEW.status_id AND json_extract(NEW.normalized_json,'$.text')=NEW.complete_text
 AND json_extract(NEW.normalized_json,'$.sourceVersionHash')=NEW.source_version_hash)
BEGIN SELECT RAISE(ABORT,'X_PAGE_CAPTURE_PERMIT_REQUIRED'); END;
CREATE TRIGGER x_page_producer_receipt_insert_guard BEFORE INSERT ON x_page_producer_receipt_v1
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN pending_review_candidate c ON c.candidate_id=NEW.candidate_id
 JOIN x_page_candidate_capture_v1 cap ON cap.candidate_id=c.candidate_id AND cap.source_revision=NEW.source_revision
 WHERE p.entity_kind='x_page_producer_receipt' AND p.entity_id=NEW.receipt_entity_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-trusted-import-live' AND op.operation_id=NEW.operation_id AND op.source_id=NEW.source_id AND op.candidate_id=NEW.candidate_id
 AND c.source_id=NEW.source_id AND c.source_revision=NEW.source_revision AND c.source_payload_hash=NEW.captured_source_version_hash
 AND cap.source_version_hash=NEW.captured_source_version_hash
 AND json_extract(NEW.receipt_json,'$.producerId')=NEW.producer_id AND json_extract(NEW.receipt_json,'$.receiptId')=NEW.receipt_id
 AND json_extract(NEW.receipt_json,'$.captureSha256')=NEW.capture_sha256 AND json_extract(NEW.receipt_json,'$.captureProofSha256')=NEW.capture_proof_sha256
 AND json_extract(NEW.receipt_json,'$.result.operationId')=NEW.operation_id AND json_extract(NEW.receipt_json,'$.result.candidateId')=NEW.candidate_id
 AND json_extract(NEW.receipt_json,'$.result.sourceRevision')=NEW.source_revision)
BEGIN SELECT RAISE(ABORT,'X_PAGE_RECEIPT_PERMIT_REQUIRED'); END;
CREATE TRIGGER x_page_source_admission_insert_guard BEFORE INSERT ON x_page_source_admission_v1
WHEN NOT EXISTS(SELECT 1 FROM authorized_gateway_write_permit_v1 p JOIN internal_operation op ON op.operation_id=p.operation_id
 JOIN source_registry_v1 r ON r.source_id=NEW.source_id JOIN internal_control ctl ON ctl.singleton_id=1
 WHERE p.entity_kind='x_page_source_admission' AND p.entity_id=NEW.admission_id AND p.mutation_kind='insert' AND p.consumed_at IS NULL
 AND op.policy_id='p-x-page-source-admit-paused' AND op.operation_id=NEW.operation_id AND op.source_id=NEW.source_id
 AND r.source_kind='x_page' AND r.revision+1=NEW.registry_revision AND ctl.phase='paused' AND ctl.global_stop_state='stopped'
 AND ctl.emergency_stop_state='clear' AND ctl.recovery_state='ready' AND NEW.admitted_at<=op.updated_at AND unixepoch(op.updated_at)-unixepoch(NEW.admitted_at)<=5 AND NEW.expires_at>op.updated_at)
BEGIN SELECT RAISE(ABORT,'X_PAGE_SOURCE_ADMISSION_PERMIT_REQUIRED'); END;

CREATE TRIGGER x_page_source_admission_v1_deny_update BEFORE UPDATE ON x_page_source_admission_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_source_admission_v1_deny_delete BEFORE DELETE ON x_page_source_admission_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_producer_receipt_v1_deny_update BEFORE UPDATE ON x_page_producer_receipt_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_producer_receipt_v1_deny_delete BEFORE DELETE ON x_page_producer_receipt_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_candidate_capture_v1_deny_update BEFORE UPDATE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_candidate_capture_v1_deny_delete BEFORE DELETE ON x_page_candidate_capture_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_admission_identity_v1_deny_update BEFORE UPDATE ON x_page_admission_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_admission_identity_v1_deny_delete BEFORE DELETE ON x_page_admission_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_admission_identity_v1_deny_insert BEFORE INSERT ON x_page_admission_identity_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER x_page_source_config_deny_insert BEFORE INSERT ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CONFIG_IMMUTABLE'); END;

CREATE TRIGGER x_page_source_config_deny_delete BEFORE DELETE ON x_page_source_config_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_CONFIG_IMMUTABLE'); END;
CREATE TABLE x_page_operation_source_binding_v1(
 operation_id TEXT NOT NULL REFERENCES internal_operation(operation_id),source_id TEXT NOT NULL REFERENCES source(source_id),
 registry_revision INTEGER NOT NULL,identity_sha256 TEXT NOT NULL,config_revision INTEGER NOT NULL,source_stop_epoch INTEGER NOT NULL,
 source_config_epoch INTEGER NOT NULL,source_safety_epoch INTEGER NOT NULL,authorization_version INTEGER NOT NULL,policy_epoch INTEGER NOT NULL,recovery_epoch INTEGER NOT NULL,
 admission_id TEXT NOT NULL REFERENCES x_page_source_admission_v1(admission_id),authorization_receipt_sha256 TEXT NOT NULL,source_policy_sha256 TEXT NOT NULL,authorization_expires_at TEXT NOT NULL,
 PRIMARY KEY(operation_id,source_id)
) WITHOUT ROWID, STRICT;
CREATE TRIGGER x_page_operation_source_binding_insert_guard BEFORE INSERT ON x_page_operation_source_binding_v1
WHEN NOT EXISTS(SELECT 1 FROM internal_operation op JOIN operation_entity_binding b ON b.operation_id=op.operation_id
 JOIN source s ON s.source_id=b.entity_id JOIN source_registry_v1 r ON r.source_id=s.source_id JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
 WHERE op.operation_id=NEW.operation_id AND op.state='requested' AND op.policy_id LIKE 'p-x-page-%'
 AND op.policy_id NOT IN('p-x-page-source-admit-paused','p-x-page-source-update-paused') AND b.entity_kind='source' AND b.entity_id=NEW.source_id
 AND s.source_kind='x_page' AND s.enabled=1 AND r.enabled=1 AND r.lifecycle_status='active' AND r.source_stop_status='clear'
 AND r.revision=NEW.registry_revision AND r.identity_sha256=NEW.identity_sha256 AND cfg.source_revision=NEW.config_revision
 AND s.stop_epoch=NEW.source_stop_epoch AND r.source_config_epoch=NEW.source_config_epoch AND r.source_safety_epoch=NEW.source_safety_epoch
 AND r.authorization_version=NEW.authorization_version AND r.policy_epoch=NEW.policy_epoch AND r.recovery_epoch=NEW.recovery_epoch
 AND cfg.admission_id=NEW.admission_id AND cfg.authorization_receipt_sha256=NEW.authorization_receipt_sha256
 AND cfg.source_policy_sha256=NEW.source_policy_sha256 AND cfg.authorization_expires_at=NEW.authorization_expires_at)
BEGIN SELECT RAISE(ABORT,'X_PAGE_OPERATION_SOURCE_BINDING_INVALID'); END;
CREATE TRIGGER x_page_operation_source_binding_capture AFTER INSERT ON operation_entity_binding
WHEN NEW.entity_kind='source' AND EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id AND op.policy_id LIKE 'p-x-page-%' AND op.policy_id NOT IN('p-x-page-source-admit-paused','p-x-page-source-update-paused'))
BEGIN
 INSERT INTO x_page_operation_source_binding_v1 SELECT op.operation_id,s.source_id,r.revision,r.identity_sha256,cfg.source_revision,s.stop_epoch,
 r.source_config_epoch,r.source_safety_epoch,r.authorization_version,r.policy_epoch,r.recovery_epoch,cfg.admission_id,cfg.authorization_receipt_sha256,cfg.source_policy_sha256,cfg.authorization_expires_at
 FROM internal_operation op JOIN source s ON s.source_id=NEW.entity_id JOIN source_registry_v1 r ON r.source_id=s.source_id JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
 WHERE op.operation_id=NEW.operation_id;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM x_page_operation_source_binding_v1 WHERE operation_id=NEW.operation_id AND source_id=NEW.entity_id)
 THEN RAISE(ABORT,'X_PAGE_OPERATION_SOURCE_BINDING_MISSING') END;
END;
CREATE TRIGGER x_page_operation_source_binding_no_update BEFORE UPDATE ON x_page_operation_source_binding_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER x_page_operation_source_binding_no_delete BEFORE DELETE ON x_page_operation_source_binding_v1 BEGIN SELECT RAISE(ABORT,'X_PAGE_SOURCE_BINDING_IMMUTABLE'); END;
CREATE VIEW x_page_operation_source_binding_current_v1 AS SELECT b.* FROM x_page_operation_source_binding_v1 b
 JOIN internal_operation op ON op.operation_id=b.operation_id JOIN internal_control ctl ON ctl.singleton_id=1
 JOIN source s ON s.source_id=b.source_id JOIN source_registry_v1 r ON r.source_id=b.source_id JOIN x_page_source_config_v1 cfg ON cfg.source_id=b.source_id
 WHERE b.registry_revision=r.revision AND b.identity_sha256=r.identity_sha256 AND b.config_revision=cfg.source_revision AND b.source_stop_epoch=s.stop_epoch
 AND b.source_config_epoch=r.source_config_epoch AND b.source_safety_epoch=r.source_safety_epoch AND b.authorization_version=r.authorization_version
 AND b.policy_epoch=r.policy_epoch AND b.recovery_epoch=r.recovery_epoch AND b.admission_id=cfg.admission_id
 AND b.authorization_receipt_sha256=cfg.authorization_receipt_sha256 AND b.source_policy_sha256=cfg.source_policy_sha256 AND b.authorization_expires_at=cfg.authorization_expires_at
 AND op.source_config_epoch=ctl.source_config_epoch AND op.source_safety_epoch=ctl.source_safety_epoch AND op.authorization_version=ctl.authorization_version
 AND op.policy_epoch=ctl.policy_epoch AND op.recovery_epoch=ctl.recovery_epoch AND op.expected_writer_epoch=ctl.writer_epoch
 AND s.enabled=1 AND r.enabled=1 AND r.source_kind='x_page' AND r.lifecycle_status='active' AND r.source_stop_status='clear';

-- Immutable successor to 0014; registry-local clocks and runtime-global clocks
-- remain separate. Old receipts are not backfilled or promoted.
CREATE TABLE x_page_automatic_source_binding_v1 (
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
CREATE TRIGGER x_page_automatic_source_binding_no_update BEFORE UPDATE ON x_page_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'X_PAGE_AUTO_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER x_page_automatic_source_binding_no_delete BEFORE DELETE ON x_page_automatic_source_binding_v1
BEGIN SELECT RAISE(ABORT,'X_PAGE_AUTO_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER x_page_automatic_source_binding_insert_guard BEFORE INSERT ON x_page_automatic_source_binding_v1
WHEN NOT EXISTS (
 SELECT 1 FROM generic_fence_receipt f JOIN internal_operation op ON op.operation_id=f.issued_by_operation_id
 JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
 JOIN source s ON s.source_id=op.source_id JOIN source_registry_v1 r ON r.source_id=s.source_id
 JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
 WHERE f.fence_receipt_id=NEW.fence_receipt_id AND f.issued_by_operation_id=NEW.issued_by_operation_id
 AND NEW.source_id=s.source_id AND f.reason_code IN ('X_PAGE_AUTOMATIC_CURRENT_V1','X_PAGE_AUTOMATIC_COMMITTED_DELIVERY_V1')
 AND f.issuer='f1plus1-system-supervisor-v1' AND f.state='clear'
 AND op.state='authorized' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
 AND op.capability_class='control' AND op.control_action='fence_update'
 AND op.policy_id IN ('p-x-page-fence-live')
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
) BEGIN SELECT RAISE(ABORT,'X_PAGE_AUTO_SOURCE_BINDING_UNAUTHORIZED'); END;
CREATE TRIGGER x_page_automatic_source_binding_capture AFTER INSERT ON generic_fence_receipt
WHEN NEW.reason_code IN ('X_PAGE_AUTOMATIC_CURRENT_V1','X_PAGE_AUTOMATIC_COMMITTED_DELIVERY_V1')
BEGIN
 INSERT INTO x_page_automatic_source_binding_v1
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
 JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
 WHERE op.operation_id=NEW.issued_by_operation_id;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM x_page_automatic_source_binding_v1 WHERE fence_receipt_id=NEW.fence_receipt_id)
   THEN RAISE(ABORT,'X_PAGE_AUTO_SOURCE_BINDING_MISSING') END;
END;
CREATE VIEW x_page_automatic_source_binding_current_v1 AS
SELECT binding.* FROM x_page_automatic_source_binding_v1 binding
JOIN source s ON s.source_id=binding.source_id
JOIN source_registry_v1 r ON r.source_id=s.source_id
JOIN x_page_source_config_v1 cfg ON cfg.source_id=s.source_id
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


CREATE VIEW x_page_automatic_fence_current_v1 AS
SELECT f.*,op.candidate_id,op.source_id,op.publication_id,
       op.expected_entity_version AS source_revision,op.expected_entity_hash AS input_content_hash
FROM generic_fence_receipt f
JOIN x_page_automatic_source_binding_current_v1 sb ON sb.fence_receipt_id=f.fence_receipt_id AND sb.issued_by_operation_id=f.issued_by_operation_id
JOIN internal_operation op ON op.operation_id=f.issued_by_operation_id
JOIN owner_authorization_handoff h ON h.handoff_id=op.authorization_handoff_id
JOIN pending_review_candidate c ON c.candidate_id=op.candidate_id AND c.source_id=op.source_id
JOIN source s ON s.source_id=c.source_id
JOIN source_registry_v1 r ON r.source_id=c.source_id
JOIN x_page_source_config_v1 cfg ON cfg.source_id=c.source_id
JOIN internal_control ctl ON ctl.singleton_id=1
WHERE f.reason_code='X_PAGE_AUTOMATIC_CURRENT_V1' AND f.issuer='f1plus1-system-supervisor-v1' AND f.state='clear'
AND op.state='succeeded' AND op.owner_process='system_supervisor' AND op.operation_kind='system_producer'
AND op.capability_class='control' AND op.control_action='fence_update'
AND op.policy_id IN ('p-x-page-fence-live')
AND h.owner_process=op.owner_process AND h.consumed_by_operation_id=op.operation_id
AND h.release_sha256=op.expected_release_sha256 AND h.manifest_sha256=op.expected_manifest_sha256
AND c.source_revision=op.expected_entity_version AND c.source_payload_hash=op.expected_entity_hash
AND op.source_config_epoch=ctl.source_config_epoch AND op.source_safety_epoch=ctl.source_safety_epoch
AND op.authorization_version=ctl.authorization_version AND op.policy_epoch=ctl.policy_epoch
AND op.recovery_epoch=ctl.recovery_epoch AND op.expected_writer_epoch=ctl.writer_epoch
AND f.policy_epoch=op.policy_epoch AND f.recovery_epoch=op.recovery_epoch AND f.writer_epoch=op.expected_writer_epoch
AND s.enabled=1 AND s.stop_epoch=op.source_stop_epoch AND r.enabled=1 AND r.source_kind='x_page'
AND r.lifecycle_status='active' AND r.collection_onboarding_status='active' AND r.source_stop_status='clear'
AND r.revision=cfg.source_revision
AND r.normalization_status='valid' AND r.dedup_status IN ('unique','linked_existing')
AND r.monitorability='monitorable' AND r.adapter_status='ready' AND r.adapter_authorization_status='valid' AND r.platform_allowed='allowed'
AND cfg.rights_status='clear' AND cfg.media_policy='blocked' AND r.authorization_expires_at>=f.expires_at
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
 AND b.expected_entity_version=c.source_revision AND b.expected_entity_hash=c.source_payload_hash)
AND NOT EXISTS(SELECT 1 FROM operation_entity_binding declared LEFT JOIN x_page_operation_source_binding_current_v1 current
 ON current.operation_id=declared.operation_id AND current.source_id=declared.entity_id
 WHERE declared.operation_id=op.operation_id AND declared.entity_kind='source'
 AND (current.operation_id IS NULL OR current.authorization_expires_at<f.expires_at));

CREATE TRIGGER x_page_automatic_fence_consumer_guard_v1 BEFORE INSERT ON operation_fence_binding
WHEN EXISTS(SELECT 1 FROM internal_operation op WHERE op.operation_id=NEW.operation_id AND op.policy_id IN('p-x-page-refine-live','p-x-page-refine-store-live','p-x-page-auto-review-live','p-x-page-auto-publish-live'))
AND NOT EXISTS(SELECT 1 FROM x_page_automatic_fence_current_v1 f JOIN internal_operation op ON op.operation_id=NEW.operation_id
WHERE f.fence_receipt_id=NEW.fence_receipt_id AND f.candidate_id=op.candidate_id AND f.source_id=op.source_id)
BEGIN SELECT RAISE(ABORT,'X_PAGE_AUTO_FENCE_CURRENT_REQUIRED'); END;

CREATE TRIGGER x_page_policy_source_guard BEFORE INSERT ON internal_operation
WHEN (NEW.policy_id LIKE 'p-x-page-%' AND (NOT EXISTS(SELECT 1 FROM source WHERE source_id=NEW.source_id AND source_kind='x_page')
 OR EXISTS(SELECT 1 FROM json_each(NEW.entity_set_json) e JOIN source s ON s.source_id=json_extract(e.value,'$.entityId')
 WHERE json_extract(e.value,'$.entityKind')='source' AND s.source_kind<>'x_page')
 OR EXISTS(SELECT 1 FROM json_each(NEW.entity_set_json) e JOIN pending_review_candidate c ON c.candidate_id=json_extract(e.value,'$.entityId') JOIN source s ON s.source_id=c.source_id
 WHERE json_extract(e.value,'$.entityKind')='candidate' AND s.source_kind<>'x_page')))
 OR (NEW.policy_id NOT LIKE 'p-x-page-%' AND NEW.owner_process<>'projection_receiver'
 AND (EXISTS(SELECT 1 FROM source WHERE source_id=NEW.source_id AND source_kind='x_page')
 OR EXISTS(SELECT 1 FROM json_each(NEW.entity_set_json) e WHERE json_extract(e.value,'$.entityKind') LIKE 'x_page_%')))
BEGIN SELECT RAISE(ABORT,'X_PAGE_EXPLICIT_SOURCE_POLICY_REQUIRED'); END;
