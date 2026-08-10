#!/usr/bin/env python3
"""Offline validator for TASK-20260808-CAD1DB; performs no network or Base I/O."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = ROOT / "data/real-collection-slice-v0"
SOURCE_REQUIRED = (
    "source_id platform platform_account_id handle raw_url canonical_url canonical_url_valid "
    "normalizer_version normalization_status dedup_status entity_type content_focus priority "
    "verification_status identity_status relevance_status monitorability adapter_status "
    "adapter_authorization_status platform_allowed authorization_checked_at authorization_expires_at "
    "collection_onboarding_status onboarding_operation_id lifecycle_status enabled manual_disable_at "
    "source_stop_status source_safety_epoch source_config_epoch added_at evidence_url notes "
    "migration_batch_id change_reason created_at updated_at created_by_ref updated_by_ref"
).split()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"VALIDATION_FAIL: {message}")


def safe_file(relative: str) -> Path:
    path = ROOT / relative
    require(path.exists(), f"missing {relative}")
    require(not path.is_symlink() and path.is_file(), f"unsafe file {relative}")
    require(os.path.commonpath((str(ROOT), str(path.resolve()))) == str(ROOT), f"escaped root {relative}")
    return path


def load(relative: str) -> dict:
    return json.loads(safe_file(relative).read_text(encoding="utf-8"))


def sha256_file(relative: str) -> str:
    return hashlib.sha256(safe_file(relative).read_bytes()).hexdigest()


def compact(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def main() -> None:
    manifest = load("data/real-collection-slice-v0/manifest.json")
    package = load("data/real-collection-slice-v0/input-gate-package.json")
    fixture = load("data/real-collection-slice-v0/fixture.synthetic.json")

    for relative, expected in manifest["artifact_hashes"].items():
        require(sha256_file(relative) == expected, f"artifact hash drift: {relative}")
    for relative, expected in manifest["input_hashes"].items():
        require(sha256_file(relative) == expected, f"input hash drift: {relative}")

    inventory = load("data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json")["rows"]
    require(len(inventory) == 59, "inventory must contain 59 rows")
    require(len({row["source_id"] for row in inventory}) == 59, "source_id must be 59/59 unique")
    require(all(row["platform"] == "x" for row in inventory), "current inventory must be 59 X rows")
    require(all(row["enabled"] is False for row in inventory), "current inventory must remain 59 disabled")
    require(not any(row["platform"] == "rss" for row in inventory), "current inventory unexpectedly contains RSS")

    facts = package["current_inventory_facts"]
    require(facts == {
        "artifact": "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json",
        "total_sources": 59,
        "x_sources": 59,
        "rss_sources": 0,
        "enabled_sources": 0,
        "automatically_authorized_sources": 0,
        "conclusion": "no existing authorized and enabled source can execute the first real collection slice",
    }, "declared inventory facts drift")

    require(package["status"] == "gate_closed_user_approval_required", "package must remain gate closed")
    require(package["external_effects"] == {
        "external_calls": 0,
        "writes_to_base": False,
        "provider_switch": False,
        "new_source_access": False,
        "real_content_imported": False,
    }, "package external-effect boundary drift")
    require(package["candidate"]["feed_url"] == "https://www.formula1.com/en/latest/all.xml", "candidate URL drift")
    require(package["candidate"]["evidence_state"] == "historical_local_observation_only", "candidate evidence overstated")
    require(package["candidate"]["activation_decision"] == "deny_until_user_approval_and_fresh_preflight", "activation gate opened")
    require(len(package["user_decision_gate"]["required_confirmations"]) == 3, "three explicit user confirmations required")

    schema = load("data/mvp-contract-v0/schema.json")
    schema_required = schema["$defs"]["Source"]["required"]
    require(schema_required == SOURCE_REQUIRED, "validator Source list drifted from frozen schema")
    mapping = package["source_field_mapping"]
    require(list(mapping) == SOURCE_REQUIRED, "Source mapping must cover exact ordered 39 fields")
    for field in SOURCE_REQUIRED:
        require(mapping[field]["input_pointer"] == f"/candidate_source/{field}", f"Source input pointer drift: {field}")
        require(mapping[field]["contract_pointer"] == f"data/mvp-contract-v0/schema.json#/$defs/Source/properties/{field}", f"Source contract pointer drift: {field}")

    source = fixture["candidate_source"]
    require(list(source) == SOURCE_REQUIRED, "candidate Source must contain exact 39 fields")
    require(source["enabled"] is False, "candidate Source must stay disabled")
    require(source["collection_onboarding_status"] == "validating", "candidate Source must stay validating")
    require(source["normalization_status"] == "pending" and source["dedup_status"] == "pending", "normalization/dedup must stay pending")
    require(source["identity_status"] == "unknown" and source["relevance_status"] == "unknown", "identity/relevance must stay unknown")
    require(source["monitorability"] == "unknown" and source["adapter_status"] == "unchecked", "monitorability/adapter must stay unresolved")
    require(source["adapter_authorization_status"] == "unknown" and source["platform_allowed"] == "unknown", "authorization/platform gate must stay unresolved")
    require(source["onboarding_operation_id"] is None, "candidate must not have an activation operation")
    require(source["source_config_epoch"] == 1 and source["source_safety_epoch"] == 1, "fixture fences must be nonzero")

    require(fixture["synthetic_only"] is True and fixture["external_calls"] == 0, "fixture must be synthetic/offline")
    require(fixture["writes_to_base"] is False and fixture["provider_switch"] is False, "fixture must not mutate provider/Base")
    item = fixture["source_item"]
    require(item["canonical_url"].startswith("https://synthetic.invalid/"), "source_item must be synthetic")
    require(item["published_at"] is None and item["timestamp_confidence"] == "unknown", "missing publication time must remain unknown/null")
    require(item["slo_eligible"] is False and item["discovery_latency_ms"] is None and item["within_15_minutes"] is None, "ineligible SLO sample must remain null")
    require(item["media"] == [] and item["rights_status"] == "unknown", "unknown rights must produce no media")
    require(item["ingest_allowed"] is False and fixture["expected"]["item_persisted"] is False, "gate-closed item must not persist")

    expected_response = hashlib.sha256(b"synthetic:rss-response:001").hexdigest()
    require(item["response_hash"] == expected_response, "synthetic response hash mismatch")
    expected_cursor = f"cursor:sha256:{expected_response}"
    require(item["cursor_ref"] == expected_cursor, "cursor ref mismatch")
    expected_dedupe = hashlib.sha256(f'{item["source_id"]}\x1f{item["external_id"]}'.encode("utf-8")).hexdigest()
    require(item["dedupe_key"] == expected_dedupe, "dedupe key mismatch")
    content_input = {
        "body_text": item["body_text"],
        "canonical_url": item["canonical_url"],
        "external_id": item["external_id"],
        "title": item["title"],
    }
    require(item["content_hash"] == hashlib.sha256(compact(content_input)).hexdigest(), "synthetic content hash mismatch")

    mapping_keys = set(package["source_item_field_mapping"])
    required_mapping_keys = {
        "source_id", "external_id", "guid", "canonical_url", "title", "body_text", "author",
        "published_at", "observed_at", "discovered_at", "response_hash", "cursor_ref",
        "content_hash", "dedupe_key", "timestamp_confidence", "media", "rights_status", "pre_review_status",
    }
    require(mapping_keys == required_mapping_keys, "source_item mapping key set drift")
    require(package["cursor_contract"]["http_304"].startswith("record successful poll health"), "304 cursor behavior missing")
    require(package["time_contract"]["slo_target_ms"] == 900000, "15-minute target drift")
    require(package["fifteen_minute_metrics"]["empty_denominator"] == "unknown/not_measurable; never PASS", "empty SLO denominator must not pass")
    require(package["media_policy"]["default_rights_status"] == "unknown", "rights default drift")
    require(package["pre_review_exit"]["prohibited"][0] == "automatic publication", "manual-review boundary drift")

    research = safe_file("research/multi-platform-source-collection-2026-07-30.md").read_text(encoding="utf-8")
    require("https://www.formula1.com/en/latest/all.xml" in research, "local candidate evidence missing")
    require("没有 `pubDate`" in research, "local publication-time limitation missing")
    adr = safe_file("docs/decisions/system/2026-08-01-F1+1-信源库A到D演进路线-accepted.md").read_text(encoding="utf-8")
    require("status: accepted" in adr and "不授权" in adr, "accepted ADR authorization boundary missing")

    print(json.dumps({
        "status": "PASS",
        "task_id": "TASK-20260808-CAD1DB",
        "source_mapping_fields": len(mapping),
        "source_item_mapping_fields": len(mapping_keys),
        "inventory": {"total": 59, "x": 59, "rss": 0, "enabled": 0},
        "candidate": "candidate_rss_formula1_latest_all",
        "gate": "user_approval_required",
        "external_calls": 0,
        "writes_to_base": False,
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
