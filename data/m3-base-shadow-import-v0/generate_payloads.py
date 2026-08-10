#!/usr/bin/env python3
"""Deterministically generate the M3 offline Base shadow-import payloads."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(__file__).resolve().parent
INPUT_CSV = PROJECT_ROOT / "data/x-source-inventory-v0.csv"
CONTRACT = (
    PROJECT_ROOT
    / "docs/collaboration/部门/产品部/报告/2026-08-01-F1+1飞书Base影子建表-M3执行包.md"
)
EXPECTED_INPUT_SHA256 = "bbb84a7f8f625e8106ae6e0b2714a363940dbf3f20dcbbf300fa6552de1ac01b"
EXPECTED_CONTRACT_SHA256 = "86ce6de47711ae912059a1ea4122a1885b7990385f6930cd050749feebf118c1"
BATCH_ID = "M3-20260801-X59-01"
CHANGE_REASON = "M3 shadow import; no truth/provider switch"

EXPECTED_CSV_FIELDS = [
    "source_id",
    "platform",
    "handle",
    "canonical_url",
    "entity_type",
    "content_focus",
    "identity_status",
    "monitorability",
    "priority",
    "lifecycle_status",
    "added_at",
    "evidence_url",
    "notes",
]

MAIN_SOURCE_FIELDS = [
    {"type": "text", "name": "source_id", "description": "项目内稳定主键；创建后不随 handle 改名"},
    {"type": "select", "name": "platform", "multiple": False, "options": [{"name": "x"}]},
    {"type": "text", "name": "platform_account_id", "description": "可靠取得前保持空值"},
    {"type": "text", "name": "handle"},
    {"type": "text", "name": "raw_url", "style": {"type": "url"}},
    {"type": "text", "name": "canonical_url", "style": {"type": "url"}},
    {"type": "checkbox", "name": "canonical_url_valid"},
    {"type": "text", "name": "normalizer_version"},
    {
        "type": "select",
        "name": "normalization_status",
        "multiple": False,
        "options": [{"name": name} for name in ("pending", "valid", "invalid", "needs_review")],
    },
    {
        "type": "select",
        "name": "dedup_status",
        "multiple": False,
        "options": [{"name": name} for name in ("pending", "unique", "linked_existing", "needs_review")],
    },
    {
        "type": "select",
        "name": "entity_type",
        "multiple": False,
        "options": [
            {"name": name}
            for name in (
                "official_org_team_event",
                "driver_or_manager",
                "journalist_commentator_media",
                "fan_news_aggregator",
                "image_entertainment_other",
            )
        ],
    },
    {
        "type": "select",
        "name": "content_focus",
        "multiple": False,
        "options": [
            {"name": name}
            for name in (
                "team_or_series_updates",
                "driver_or_manager_updates",
                "journalism_commentary",
                "fan_news_aggregation",
                "visual_entertainment_or_other",
            )
        ],
    },
    {
        "type": "select",
        "name": "priority",
        "multiple": False,
        "options": [{"name": name} for name in ("high", "medium", "low")],
    },
    {
        "type": "select",
        "name": "verification_status",
        "multiple": False,
        "options": [{"name": name} for name in ("pending", "confirmed", "rejected")],
    },
    {
        "type": "select",
        "name": "identity_status",
        "multiple": False,
        "options": [{"name": name} for name in ("unknown", "verified", "needs_review")],
    },
    {
        "type": "select",
        "name": "relevance_status",
        "multiple": False,
        "options": [{"name": name} for name in ("unknown", "qualified", "rejected")],
    },
    {
        "type": "select",
        "name": "monitorability",
        "multiple": False,
        "options": [{"name": name} for name in ("unknown", "monitorable", "restricted", "unavailable")],
    },
    {
        "type": "select",
        "name": "adapter_status",
        "multiple": False,
        "options": [{"name": name} for name in ("unchecked", "ready", "missing", "unavailable")],
    },
    {
        "type": "select",
        "name": "adapter_authorization_status",
        "multiple": False,
        "options": [{"name": name} for name in ("unknown", "valid", "invalid", "expired")],
    },
    {"type": "datetime", "name": "authorization_checked_at", "style": {"format": "yyyy-MM-dd HH:mm"}},
    {"type": "datetime", "name": "authorization_expires_at", "style": {"format": "yyyy-MM-dd HH:mm"}},
    {
        "type": "select",
        "name": "collection_onboarding_status",
        "multiple": False,
        "options": [
            {"name": name}
            for name in (
                "validating",
                "activation_pending",
                "queued",
                "collecting",
                "active",
                "normalization_failed",
                "dedup_needs_review",
                "linked_existing",
                "blocked_adapter_missing",
                "blocked_authorization",
                "blocked_platform",
                "queue_failed",
                "collection_failed",
            )
        ],
    },
    {"type": "text", "name": "onboarding_operation_id", "description": "首次生成后不可变；重试必须复用"},
    {
        "type": "select",
        "name": "lifecycle_status",
        "multiple": False,
        "options": [{"name": name} for name in ("proposed", "active", "paused", "retired")],
    },
    {"type": "checkbox", "name": "enabled"},
    {"type": "datetime", "name": "manual_disable_at", "style": {"format": "yyyy-MM-dd HH:mm"}},
    {
        "type": "select",
        "name": "source_stop_status",
        "multiple": False,
        "options": [{"name": name} for name in ("clear", "manual", "compliance", "authorization", "platform")],
    },
    {
        "type": "number",
        "name": "source_safety_epoch",
        "style": {"type": "plain", "precision": 0, "percentage": False, "thousands_separator": False},
    },
    {"type": "datetime", "name": "added_at", "style": {"format": "yyyy-MM-dd"}},
    {"type": "text", "name": "evidence_url", "style": {"type": "url"}},
    {"type": "text", "name": "notes"},
    {"type": "text", "name": "migration_batch_id"},
    {"type": "text", "name": "change_reason"},
]

MOBILE_CAPTURE_FIELDS = [
    {
        "type": "auto_number",
        "name": "capture_id",
        "style": {
            "rules": [
                {"type": "text", "text": "CAP-"},
                {"type": "created_time", "date_format": "yyyyMMdd"},
                {"type": "incremental_number", "length": 4},
            ]
        },
    },
    {"type": "text", "name": "raw_url", "style": {"type": "url"}},
    {"type": "text", "name": "capture_note"},
    {"type": "created_at", "name": "captured_at", "style": {"format": "yyyy-MM-dd HH:mm"}},
    {
        "type": "select",
        "name": "normalization_status",
        "multiple": False,
        "options": [{"name": name} for name in ("pending", "valid", "invalid", "needs_review")],
    },
    {"type": "text", "name": "normalization_error"},
    {
        "type": "select",
        "name": "dedup_status",
        "multiple": False,
        "options": [{"name": name} for name in ("pending", "unique", "linked_existing", "needs_review")],
    },
    {"type": "text", "name": "dedup_match_source_id"},
    {"type": "text", "name": "source_id"},
]

RECORD_FIELDS = [
    "source_id",
    "platform",
    "platform_account_id",
    "handle",
    "raw_url",
    "canonical_url",
    "canonical_url_valid",
    "normalizer_version",
    "normalization_status",
    "dedup_status",
    "entity_type",
    "content_focus",
    "priority",
    "verification_status",
    "identity_status",
    "relevance_status",
    "monitorability",
    "adapter_status",
    "adapter_authorization_status",
    "authorization_checked_at",
    "authorization_expires_at",
    "collection_onboarding_status",
    "onboarding_operation_id",
    "lifecycle_status",
    "enabled",
    "manual_disable_at",
    "source_stop_status",
    "source_safety_epoch",
    "added_at",
    "evidence_url",
    "notes",
    "migration_batch_id",
    "change_reason",
]

ENTITY_TYPES = {
    "official_org_team_event",
    "driver_or_manager",
    "journalist_commentator_media",
    "fan_news_aggregator",
    "image_entertainment_other",
}
CONTENT_FOCUS_VALUES = {
    "team_or_series_updates",
    "driver_or_manager_updates",
    "journalism_commentary",
    "fan_news_aggregation",
    "visual_entertainment_or_other",
}
PRIORITIES = {"high", "medium", "low"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n").encode("utf-8")


def write_json(path: Path, value: object) -> str:
    payload = json_bytes(value)
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def load_and_validate_csv() -> list[dict[str, str]]:
    if sha256(INPUT_CSV) != EXPECTED_INPUT_SHA256:
        raise SystemExit("input CSV SHA-256 differs from the product contract")
    if sha256(CONTRACT) != EXPECTED_CONTRACT_SHA256:
        raise SystemExit("product execution package SHA-256 changed; re-review before generating")

    with INPUT_CSV.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != EXPECTED_CSV_FIELDS:
            raise SystemExit("input CSV header differs from the product contract")
        rows = list(reader)

    if len(rows) != 59:
        raise SystemExit(f"expected 59 data rows, got {len(rows)}")
    if len({row["source_id"].casefold() for row in rows}) != 59:
        raise SystemExit("source_id is not case-insensitively unique")
    if len({row["canonical_url"].casefold() for row in rows}) != 59:
        raise SystemExit("canonical_url is not case-insensitively unique")
    if {row["platform"] for row in rows} != {"x"}:
        raise SystemExit("platform values differ from the product contract")
    if not {row["entity_type"] for row in rows} <= ENTITY_TYPES:
        raise SystemExit("entity_type contains an unsupported enum")
    if not {row["content_focus"] for row in rows} <= CONTENT_FOCUS_VALUES:
        raise SystemExit("content_focus contains an unsupported enum")
    if not {row["priority"] for row in rows} <= PRIORITIES:
        raise SystemExit("priority contains an unsupported enum")
    if {row["identity_status"] for row in rows} != {"unknown"}:
        raise SystemExit("identity_status must remain unknown for all rows")
    if {row["monitorability"] for row in rows} != {"unknown"}:
        raise SystemExit("monitorability must remain unknown for all rows")
    if {row["lifecycle_status"] for row in rows} != {"proposed"}:
        raise SystemExit("lifecycle_status must remain proposed for all rows")
    return rows


def build_record(row: dict[str, str]) -> list[object]:
    return [
        row["source_id"],
        row["platform"],
        None,
        row["handle"],
        row["evidence_url"],
        row["canonical_url"],
        True,
        "m2_x_url_v1",
        "valid",
        "pending",
        row["entity_type"],
        row["content_focus"],
        row["priority"],
        "pending",
        row["identity_status"],
        "unknown",
        row["monitorability"],
        "unchecked",
        "unknown",
        None,
        None,
        "validating",
        None,
        row["lifecycle_status"],
        False,
        None,
        "clear",
        1,
        f'{row["added_at"]} 00:00:00',
        row["evidence_url"],
        row["notes"],
        BATCH_ID,
        CHANGE_REASON,
    ]


def main() -> None:
    rows = load_and_validate_csv()
    batch_rows = [build_record(row) for row in rows]
    if len(MAIN_SOURCE_FIELDS) != 33 or len(MOBILE_CAPTURE_FIELDS) != 9:
        raise SystemExit("field-definition count differs from the product contract")
    if len(RECORD_FIELDS) != 33 or any(len(row) != 33 for row in batch_rows):
        raise SystemExit("record batch does not contain exactly 33 values per row")

    names = [field["name"] for field in MAIN_SOURCE_FIELDS]
    if names != RECORD_FIELDS:
        raise SystemExit("record field order differs from main table field order")

    record_payload = {"fields": RECORD_FIELDS, "rows": batch_rows}
    output_hashes = {
        "main-source-fields.json": write_json(OUTPUT_DIR / "main-source-fields.json", MAIN_SOURCE_FIELDS),
        "mobile-capture-fields.json": write_json(OUTPUT_DIR / "mobile-capture-fields.json", MOBILE_CAPTURE_FIELDS),
        "main-source-record-batch.json": write_json(OUTPUT_DIR / "main-source-record-batch.json", record_payload),
    }

    column_counts = {field: Counter(row[index] for row in batch_rows) for index, field in enumerate(RECORD_FIELDS)}
    manifest = {
        "schema_version": 1,
        "task_id": "TASK-20260801-5A90E3",
        "mode": "offline_payload_only",
        "external_write_performed": False,
        "input": {
            "path": "data/x-source-inventory-v0.csv",
            "sha256": EXPECTED_INPUT_SHA256,
            "data_rows": len(rows),
            "source_id_case_insensitive_unique": len({row["source_id"].casefold() for row in rows}),
            "canonical_url_case_insensitive_unique": len({row["canonical_url"].casefold() for row in rows}),
        },
        "contract": {
            "path": "docs/collaboration/部门/产品部/报告/2026-08-01-F1+1飞书Base影子建表-M3执行包.md",
            "sha256": EXPECTED_CONTRACT_SHA256,
            "migration_batch_id": BATCH_ID,
        },
        "payloads": [
            {"path": f"data/m3-base-shadow-import-v0/{name}", "sha256": digest}
            for name, digest in output_hashes.items()
        ],
        "counts": {
            "main_source_field_definitions": len(MAIN_SOURCE_FIELDS),
            "mobile_capture_field_definitions": len(MOBILE_CAPTURE_FIELDS),
            "record_fields": len(RECORD_FIELDS),
            "record_rows": len(batch_rows),
            "values_per_record": 33,
        },
        "default_value_checks": {
            "dedup_status_pending": column_counts["dedup_status"]["pending"],
            "verification_status_pending": column_counts["verification_status"]["pending"],
            "identity_status_unknown": column_counts["identity_status"]["unknown"],
            "relevance_status_unknown": column_counts["relevance_status"]["unknown"],
            "monitorability_unknown": column_counts["monitorability"]["unknown"],
            "adapter_authorization_status_unknown": column_counts["adapter_authorization_status"]["unknown"],
            "lifecycle_status_proposed": column_counts["lifecycle_status"]["proposed"],
            "enabled_false": column_counts["enabled"][False],
            "migration_batch_id_matches": column_counts["migration_batch_id"][BATCH_ID],
        },
        "security": {
            "credential_material_present": False,
            "external_resource_identifiers_present": False,
            "personal_identifiers_present": False,
        },
    }
    write_json(OUTPUT_DIR / "manifest.json", manifest)


if __name__ == "__main__":
    main()
