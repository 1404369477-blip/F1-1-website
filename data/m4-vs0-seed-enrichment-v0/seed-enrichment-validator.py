#!/usr/bin/env python3
"""Offline VS-0 M3 -> Source seed enrichment validator.

This tool reads the frozen M3 batch and frozen Source schema, emits an
implementation fixture outside data/mvp-contract-v0, and writes a manifest.
It never opens a socket, invokes a provider, writes Base, or mutates the
frozen v0.3 contract.  The bridge is intentionally not a JSON Schema.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_DIR = PROJECT_ROOT / "data" / "m4-vs0-seed-enrichment-v0"
M3_DIR = PROJECT_ROOT / "data" / "m3-base-shadow-import-v0"
CONTRACT_DIR = PROJECT_ROOT / "data" / "mvp-contract-v0"
MAPPING_PATH = BRIDGE_DIR / "implementation-mapping.json"
SCHEMA_PATH = CONTRACT_DIR / "schema.json"
BASE_MAPPING_PATH = CONTRACT_DIR / "base-mapping.json"
CONTRACT_MANIFEST_PATH = CONTRACT_DIR / "manifest.json"
M3_BATCH_PATH = M3_DIR / "main-source-record-batch.json"
M3_FIELDS_PATH = M3_DIR / "main-source-fields.json"
M3_MANIFEST_PATH = M3_DIR / "manifest.json"

EXPECTED_M3_BATCH_SHA256 = "e73b8d6b8a9b1a018dc7d30c90bfe3111b10caeb6fee28486edf27f176a05de5"
EXPECTED_M3_FIELDS_SHA256 = "b743abaee8ef68db586148e58afdcc9dec2b6fe07bab61ad7c779327d4076870"
EXPECTED_M3_MANIFEST_SHA256 = "c6d681ba9428107801e7077a65e265176d684575d8d2e16c6958d19722791e29"
EXPECTED_SCHEMA_SHA256 = "de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4"
EXPECTED_BASE_MAPPING_SHA256 = "f0a086099d0f4ce9bbcd1afb0533aef90ec8d4f00b1618cc5114bebe40601f9d"
SUCCESSOR_ADR_PATH = PROJECT_ROOT / "docs" / "decisions" / "system" / "2026-08-02-F1+1-VS0-M3种子投影-successor-accepted.md"
EXPECTED_SUCCESSOR_ADR_SHA256 = "1b1fbceeecbfd5c97fdb2da91cdee12eb4fe6a032aec3463179964aab31e6db6"
EXPECTED_CONTRACT_MANIFEST_SHA256 = "8a371102c28eaa557d33df8672338cb3aba7b7ae1fe75c0c357c8edaa23b2cde"
EXPECTED_CONTRACT_ARTIFACT_HASHES = {
    "data/mvp-contract-v0/schema.json": "de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4",
    "data/mvp-contract-v0/base-mapping.json": "f0a086099d0f4ce9bbcd1afb0533aef90ec8d4f00b1618cc5114bebe40601f9d",
    "data/mvp-contract-v0/state-machine.json": "d5ca45fd60c2ad08c60929abd714f6e80c43c20f561be0c0a18e3baa17c7c120",
    "data/mvp-contract-v0/fixtures.synthetic.json": "e56122c0d99761df2e48bfed817c45e0e184d10130ea5bfce89e1d1be56f4abf",
    "data/mvp-contract-v0/runtime-envelope.schema.json": "15d398cbaaefa37dabfa6af9b7b9c3cc8b207922ef67b0889329366f8336b30d",
    "data/mvp-contract-v0/security-fixtures.schema.json": "3a8dcd859f48edcd65ab6a05a4b34280f3629f7c879236dbab3ce83e61b78d0a",
    "data/mvp-contract-v0/security-fixtures.synthetic.json": "66ace7a1e1800d740f75b35fd55234c7417b9acae7ef1c0a32757eec3051db22",
    "data/mvp-contract-v0/internal-contract.schema.json": "462605a2258d2922d9b982f490aeda3a1395f9e1dcf718fb8745e49db2afade8",
    "data/mvp-contract-v0/internal-fixtures.synthetic.json": "6fa873675732a06e440d8d67923647a9938d264b1162a485d3abf02ef33f86d8",
    "data/mvp-contract-v0/seed-layers.json": "d8a9d5cbfb8f3b209557ef7c6ef904e8c63b03d577b461d4f2ecb2aae7b40459",
    "data/mvp-contract-v0/generate_contract.py": "3f62c2eabdbd95c4b26bb878028481695aed5ab93173d3cba608acd1e6bf3841",
}
EXPECTED_ACCEPTED_PROJECTION_HASH = "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17"

MAPPING_VERSION = "m4-vs0-seed-enrichment-v0.3"
OUTPUT_NAME = "source-seed-enriched.json"
MANIFEST_NAME = "manifest.json"
VALIDATOR_RELPATH = "data/m4-vs0-seed-enrichment-v0/seed-enrichment-validator.py"
MAPPING_RELPATH = "data/m4-vs0-seed-enrichment-v0/implementation-mapping.json"
MANIFEST_VERSION = "m4-vs0-seed-enrichment-manifest-v0.3"


class ValidationError(RuntimeError):
    """A deterministic contract validation failure."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_text(value: Any) -> str:
    return canonical_bytes(value).decode("utf-8") + "\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot load JSON {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def pointer(path: str, field: str) -> str:
    return f"{path}/properties/{field}"


def _validate_type(value: Any, schema: dict[str, Any], path: str) -> None:
    expected = schema.get("type")
    if expected is None:
        return
    if expected == "object":
        require(isinstance(value, dict), f"{path}: expected object")
    elif expected == "array":
        require(isinstance(value, list), f"{path}: expected array")
    elif expected == "string":
        require(isinstance(value, str), f"{path}: expected string")
    elif expected == "boolean":
        require(isinstance(value, bool), f"{path}: expected boolean")
    elif expected == "integer":
        require(isinstance(value, int) and not isinstance(value, bool), f"{path}: expected integer")
    elif expected == "number":
        require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{path}: expected number")
    elif expected == "null":
        require(value is None, f"{path}: expected null")
    else:
        raise ValidationError(f"{path}: unsupported schema type {expected}")


def validate_value(value: Any, schema: dict[str, Any], path: str) -> None:
    if "anyOf" in schema:
        errors: list[str] = []
        for branch in schema["anyOf"]:
            try:
                validate_value(value, branch, path)
                return
            except ValidationError as exc:
                errors.append(str(exc))
        raise ValidationError(f"{path}: anyOf failed: {' | '.join(errors)}")

    if "const" in schema:
        require(value == schema["const"], f"{path}: expected const {schema['const']!r}")
    if "enum" in schema:
        require(value in schema["enum"], f"{path}: value {value!r} outside enum")

    _validate_type(value, schema, path)
    if isinstance(value, str):
        if "minLength" in schema:
            require(len(value) >= schema["minLength"], f"{path}: shorter than minLength")
        if "maxLength" in schema:
            require(len(value) <= schema["maxLength"], f"{path}: longer than maxLength")
        if "pattern" in schema:
            require(re.search(schema["pattern"], value) is not None, f"{path}: pattern mismatch")
        if schema.get("format") == "date":
            try:
                date.fromisoformat(value)
            except ValueError as exc:
                raise ValidationError(f"{path}: invalid ISO date") from exc
        if schema.get("format") == "date-time":
            require(
                re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", value) is not None,
                f"{path}: only UTC RFC3339 date-time is accepted by bridge",
            )
        if schema.get("format") == "uri":
            require(re.match(r"^https?://[^\s]+$", value) is not None, f"{path}: URI mismatch")
    if isinstance(value, (int, float)) and "minimum" in schema:
        require(value >= schema["minimum"], f"{path}: below minimum")
    if isinstance(value, list):
        if "minItems" in schema:
            require(len(value) >= schema["minItems"], f"{path}: below minItems")
        if schema.get("uniqueItems"):
            require(len({json.dumps(x, ensure_ascii=False, sort_keys=True) for x in value}) == len(value), f"{path}: duplicate items")
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                validate_value(item, schema["items"], f"{path}/{index}")
    if isinstance(value, dict) and schema.get("additionalProperties") is False:
        allowed = set(schema.get("properties", {}))
        require(set(value) <= allowed, f"{path}: unknown properties {sorted(set(value) - allowed)}")


def normalize_added_at(raw: Any) -> str:
    require(isinstance(raw, str), "added_at: M3 value must be a string")
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", raw)
    require(match is not None, f"added_at: expected exact M3 midnight transport value, got {raw!r}")
    try:
        date.fromisoformat(match.group(1))
    except ValueError as exc:
        raise ValidationError(f"added_at: invalid calendar date {raw!r}") from exc
    return match.group(1)


def verify_frozen_hashes() -> dict[str, str]:
    expected = {
        str(M3_BATCH_PATH.relative_to(PROJECT_ROOT)): EXPECTED_M3_BATCH_SHA256,
        str(M3_FIELDS_PATH.relative_to(PROJECT_ROOT)): EXPECTED_M3_FIELDS_SHA256,
        str(M3_MANIFEST_PATH.relative_to(PROJECT_ROOT)): EXPECTED_M3_MANIFEST_SHA256,
        str(SCHEMA_PATH.relative_to(PROJECT_ROOT)): EXPECTED_SCHEMA_SHA256,
        str(BASE_MAPPING_PATH.relative_to(PROJECT_ROOT)): EXPECTED_BASE_MAPPING_SHA256,
        str(CONTRACT_MANIFEST_PATH.relative_to(PROJECT_ROOT)): EXPECTED_CONTRACT_MANIFEST_SHA256,
        str(SUCCESSOR_ADR_PATH.relative_to(PROJECT_ROOT)): EXPECTED_SUCCESSOR_ADR_SHA256,
    }
    actual: dict[str, str] = {}
    for relpath, expected_hash in expected.items():
        path = PROJECT_ROOT / relpath
        require(path.is_file() and not path.is_symlink(), f"frozen artifact must be a regular file: {relpath}")
        actual[relpath] = sha256_file(path)
        require(actual[relpath] == expected_hash, f"frozen hash mismatch: {relpath}")

    contract_manifest = load_json(CONTRACT_MANIFEST_PATH)
    declared = contract_manifest.get("artifact_hashes")
    require(isinstance(declared, dict), "frozen contract manifest artifact_hashes missing")
    require(set(declared) == set(EXPECTED_CONTRACT_ARTIFACT_HASHES), "frozen contract manifest must contain exactly 11 artifact hashes")
    for relpath, expected_hash in EXPECTED_CONTRACT_ARTIFACT_HASHES.items():
        path = PROJECT_ROOT / relpath
        require(path.is_file() and not path.is_symlink(), f"contract artifact must be a regular file: {relpath}")
        actual_hash = sha256_file(path)
        require(declared[relpath] == expected_hash, f"contract manifest declared hash mismatch: {relpath}")
        require(actual_hash == expected_hash, f"contract artifact hash mismatch: {relpath}")
        actual[relpath] = actual_hash
    require(len(EXPECTED_CONTRACT_ARTIFACT_HASHES) == 11, "frozen contract artifact count must be 11")
    return actual


def verify_accepted_decision(mapping: dict[str, Any]) -> None:
    decision = mapping.get("accepted_decision")
    require(isinstance(decision, dict), "accepted decision reference missing")
    require(decision.get("decision_id") == "ADR-M4-VS0-SEED-002", "accepted decision id mismatch")
    require(decision.get("task_id") == "TASK-20260802-E1CFC2", "accepted decision task mismatch")
    require(decision.get("status") == "accepted", "accepted decision is not accepted")
    require(decision.get("path") == str(SUCCESSOR_ADR_PATH.relative_to(PROJECT_ROOT)), "accepted decision path mismatch")
    require(decision.get("sha256") == EXPECTED_SUCCESSOR_ADR_SHA256, "accepted decision hash declaration mismatch")
    require(mapping.get("mapping_version") == MAPPING_VERSION, "implementation mapping version mismatch")
    require(mapping.get("status") == "PASS", "implementation mapping is not PASS")
    require(mapping.get("added_at_conflict", {}).get("product_decision_required") is False, "added_at decision remains pending")


def verify_mapping_contract(mapping: dict[str, Any], schema: dict[str, Any], batch: dict[str, Any]) -> None:
    required = schema["$defs"]["Source"]["required"]
    direct = batch["fields"]
    derived = [
        "platform_allowed",
        "source_config_epoch",
        "created_at",
        "updated_at",
        "created_by_ref",
        "updated_by_ref",
    ]
    require(mapping.get("m3_direct_field_count") == 33, "mapping m3_direct_field_count must be 33")
    require(mapping.get("derived_field_count") == 6, "mapping derived_field_count must be 6")
    require(mapping.get("source_required_field_count") == 39, "mapping source_required_field_count must be 39")
    require(mapping.get("m3_direct_fields") == direct, "mapping direct field declaration differs from M3 header")
    require(mapping.get("derived_fields") == derived, "mapping derived field declaration differs from accepted six")
    require(mapping.get("source_required_fields_pointer") == "data/mvp-contract-v0/schema.json#/$defs/Source/required", "mapping Source.required pointer mismatch")
    require(set(required) - set(direct) == set(derived), "mapping difference does not equal six derived fields")
    require(set(mapping.get("derived_field_rules", {})) == set(derived), "mapping derived rules do not cover exactly six fields")
    rules = mapping["derived_field_rules"]
    require(rules["platform_allowed"].get("value") == "unknown", "platform_allowed rule drift")
    require(rules["source_config_epoch"].get("value") == 1, "source_config_epoch rule drift")
    require(rules["created_at"].get("value_rule") == "normalized_added_at + 'T00:00:00Z'", "created_at rule drift")
    require(rules["updated_at"].get("value_rule") == "created_at", "updated_at rule drift")
    require(rules["created_by_ref"].get("value") == "synthetic:seed-m3-v0", "created_by_ref rule drift")
    require(rules["updated_by_ref"].get("value") == "synthetic:seed-m3-v0", "updated_by_ref rule drift")
    safety = mapping.get("source_safety_epoch_correction", {})
    require(safety.get("rule", "").startswith("copy the M3 numeric value verbatim"), "source_safety_epoch direct rule drift")
    output = mapping.get("output_projection", {})
    require(output.get("row_count") == 59 and output.get("field_count") == 39, "mapping output count declaration drift")
    require(output.get("row_order") == "source_id Unicode code point ascending", "mapping row_order declaration drift")
    require(output.get("canonical_projection_hash") == EXPECTED_ACCEPTED_PROJECTION_HASH, "mapping expected projection hash drift")
    require(output.get("fields_pointer") == "data/mvp-contract-v0/schema.json#/$defs/Source/required", "mapping fields pointer drift")


def verify_mapping_artifact_declarations(mapping: dict[str, Any], frozen_hashes: dict[str, str]) -> None:
    declarations = {
        mapping["authoritative_domain_schema"]: mapping["authoritative_domain_schema_sha256"],
        mapping["authoritative_base_mapping"]: mapping["authoritative_base_mapping_sha256"],
        mapping["source_artifact"]: mapping["source_artifact_sha256"],
        mapping["source_fields_artifact"]: mapping["source_fields_artifact_sha256"],
        mapping["source_manifest"]: mapping["source_manifest_sha256"],
        mapping["accepted_decision"]["path"]: mapping["accepted_decision"]["sha256"],
    }
    for relpath, declared_hash in declarations.items():
        require(frozen_hashes.get(relpath) == declared_hash, f"mapping artifact SHA declaration mismatch: {relpath}")


def make_rows(mapping: dict[str, Any], schema: dict[str, Any], batch: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    m3_fields = batch.get("fields")
    m3_rows = batch.get("rows")
    direct_fields = mapping["m3_direct_fields"]
    derived_fields = mapping["derived_fields"]
    source_def = schema["$defs"]["Source"]
    required = source_def["required"]

    require(m3_fields == direct_fields, "M3 header differs from implementation mapping direct fields")
    require(len(m3_fields) == 33, f"expected M3 33 fields, got {len(m3_fields)}")
    require(len(m3_rows) == 59, f"expected 59 M3 rows, got {len(m3_rows)}")
    require(len(required) == 39, f"expected Source required39, got {len(required)}")
    require(set(required) - set(m3_fields) == set(derived_fields), "Source/M3 field difference is not exactly six derived fields")
    require(set(m3_fields) & set(derived_fields) == set(), "derived field overlaps M3 direct header")
    require("source_safety_epoch" in m3_fields, "source_safety_epoch must remain a direct M3 field")

    rows: list[dict[str, Any]] = []
    for index, values in enumerate(m3_rows):
        require(len(values) == len(m3_fields), f"row {index}: expected 33 values")
        raw = dict(zip(m3_fields, values))
        normalized_added_at = normalize_added_at(raw["added_at"])
        enriched: dict[str, Any] = dict(raw)
        enriched["added_at"] = normalized_added_at
        enriched["platform_allowed"] = "unknown"
        enriched["source_config_epoch"] = 1
        enriched["created_at"] = f"{normalized_added_at}T00:00:00Z"
        enriched["updated_at"] = enriched["created_at"]
        enriched["created_by_ref"] = "synthetic:seed-m3-v0"
        enriched["updated_by_ref"] = "synthetic:seed-m3-v0"
        ordered = {field: enriched[field] for field in required}
        rows.append(ordered)
    rows.sort(key=lambda row: row["source_id"])
    return required, rows


def validate_rows(schema: dict[str, Any], batch: dict[str, Any], required: list[str], rows: list[dict[str, Any]]) -> None:
    source_def = schema["$defs"]["Source"]
    properties = source_def["properties"]
    require(len(rows) == 59, "enriched row count must be 59")
    require(all(list(row) == required for row in rows), "every enriched row must use Source.required order")
    source_ids = [row["source_id"] for row in rows]
    canonical_urls = [row["canonical_url"] for row in rows]
    require(source_ids == sorted(source_ids), "rows must be sorted by source_id Unicode code point")
    require(len({value.casefold() for value in source_ids}) == 59, "source_id casefold uniqueness failed")
    require(len({value.casefold() for value in canonical_urls}) == 59, "canonical_url casefold uniqueness failed")
    raw_fields = batch["fields"]
    raw_by_source_id = {
        dict(zip(raw_fields, values))["source_id"]: dict(zip(raw_fields, values))
        for values in batch["rows"]
    }
    require(len(raw_by_source_id) == 59, "raw source_id uniqueness failed")
    for index, row in enumerate(rows):
        raw = raw_by_source_id[row["source_id"]]
        require(row["source_safety_epoch"] == raw["source_safety_epoch"], f"row {index}: source_safety_epoch was not copied")
        require(row["enabled"] is False, f"row {index}: enabled was promoted")
        require(row["platform_allowed"] == "unknown", f"row {index}: platform_allowed default drift")
        require(row["source_config_epoch"] == 1, f"row {index}: source_config_epoch drift")
        require(row["created_at"] == row["updated_at"], f"row {index}: seed timestamps diverge")
        require(row["created_by_ref"] == "synthetic:seed-m3-v0", f"row {index}: created actor drift")
        require(row["updated_by_ref"] == row["created_by_ref"], f"row {index}: updated actor drift")
        # M3 direct fields are copied, except added_at's explicit date projection.
        for field in raw_fields:
            if field == "added_at":
                require(row[field] == normalize_added_at(raw[field]), f"row {index}: added_at projection drift")
            else:
                require(row[field] == raw[field], f"row {index}: direct field {field} changed")
        for field in required:
            validate_value(row[field], properties[field], f"rows/{index}/{field}")


def make_fixture(mapping: dict[str, Any], required: list[str], rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "fixture_kind": "implementation_seed_fixture",
        "mapping_version": MAPPING_VERSION,
        "contract_version": "mvp-local-v0.3",
        "non_authoritative": True,
        "writes_to_base": False,
        "external_calls": 0,
        "fields": required,
        "rows": rows,
    }


def build_manifest(
    mapping: dict[str, Any],
    output_path: Path,
    output_bytes: bytes,
    projection_hash: str,
    repeat: int,
    frozen_hashes: dict[str, str],
) -> dict[str, Any]:
    artifacts = {
        **frozen_hashes,
        MAPPING_RELPATH: sha256_file(MAPPING_PATH),
        VALIDATOR_RELPATH: sha256_file(Path(__file__).resolve()),
        "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json": sha256_bytes(output_bytes),
    }
    return {
        "manifest_version": MANIFEST_VERSION,
        "mapping_version": MAPPING_VERSION,
        "contract_version": "mvp-local-v0.3",
        "accepted_decision": mapping["accepted_decision"],
        "frozen_contract_manifest": {
            "path": str(CONTRACT_MANIFEST_PATH.relative_to(PROJECT_ROOT)),
            "sha256": frozen_hashes[str(CONTRACT_MANIFEST_PATH.relative_to(PROJECT_ROOT))],
            "artifact_count": 11,
            "artifact_hashes_match": True,
        },
        "status": mapping["status"],
        "status_reason": mapping["status_reason"],
        "single_product_decision": mapping["single_product_decision"],
        "implementation_mapping": True,
        "non_authoritative": True,
        "second_domain_schema": False,
        "writes_to_base": False,
        "external_calls": 0,
        "m3_direct_field_count": 33,
        "derived_field_count": 6,
        "source_required_field_count": 39,
        "row_count": 59,
        "enabled_false_count": 59,
        "source_safety_epoch": {
            "mode": "direct_m3_copy",
            "value_set": [1],
            "field_pointer": "data/mvp-contract-v0/schema.json#/$defs/Source/properties/source_safety_epoch",
        },
        "added_at_projection": {
            "source_format": "YYYY-MM-DD HH:mm:ss",
            "target_format": "YYYY-MM-DD",
            "timezone": "calendar-date-only; no timezone inference",
            "rule": "require midnight, project calendar date",
            "product_decision_required": mapping["added_at_conflict"]["product_decision_required"],
        },
        "canonical_json_rule": "canonical-json-v1",
        "canonical_projection_hash": projection_hash,
        "canonical_projection_hash_scope": "canonical-json-v1({fields: Source.required, rows: enriched_rows})",
        "canonical_projection_row_order": "source_id Unicode code point ascending",
        "pre_decision_unsorted_candidate_hash": "96d5caf625f62d059cc51a41d7c3b6a1db623d07cea00c4d256e2d841c693aa2",
        "pre_decision_candidate_status": "superseded_by_accepted_sort",
        "determinism": {
            "repeat_count": repeat,
            "equal_projection_bytes": True,
            "equal_fixture_bytes": True,
            "validator_mode": "offline_local_generator_validator",
        },
        "artifact_hashes": artifacts,
        "manifest_hash_scope": "manifest excludes itself to avoid self-hash recursion",
    }


OUTPUT_PATH = BRIDGE_DIR / OUTPUT_NAME
MANIFEST_PATH = BRIDGE_DIR / MANIFEST_NAME


def ensure_safe_output_paths() -> None:
    require(BRIDGE_DIR.is_dir() and not BRIDGE_DIR.is_symlink(), "bridge output directory must be a real directory")
    for path in (OUTPUT_PATH, MANIFEST_PATH):
        require(not path.is_symlink(), f"refusing symlink output path: {path}")
        if path.exists():
            require(path.is_file(), f"output path must be a regular file: {path}")


def atomic_write(path: Path, data: bytes) -> None:
    ensure_safe_output_paths()
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temp_path.exists() or temp_path.is_symlink():
            temp_path.unlink()


def render_once() -> dict[str, Any]:
    require(MAPPING_PATH.is_file() and not MAPPING_PATH.is_symlink(), "implementation mapping missing or unsafe")
    mapping = load_json(MAPPING_PATH)
    schema = load_json(SCHEMA_PATH)
    batch = load_json(M3_BATCH_PATH)
    frozen_hashes = verify_frozen_hashes()
    verify_accepted_decision(mapping)
    verify_mapping_contract(mapping, schema, batch)
    verify_mapping_artifact_declarations(mapping, frozen_hashes)
    required, rows = make_rows(mapping, schema, batch)
    validate_rows(schema, batch, required, rows)

    fixture = make_fixture(mapping, required, rows)
    fixture_bytes = canonical_bytes(fixture) + b"\n"
    projection = {"fields": required, "rows": rows}
    projection_bytes = canonical_bytes(projection)
    projection_hash = sha256_bytes(projection_bytes)
    declared_hash = mapping["output_projection"]["canonical_projection_hash"]
    require(projection_hash == EXPECTED_ACCEPTED_PROJECTION_HASH, "accepted sorted projection hash drift")
    require(projection_hash == declared_hash, "projection hash differs from mapping declaration")
    return {
        "mapping": mapping,
        "frozen_hashes": frozen_hashes,
        "required": required,
        "rows": rows,
        "fixture_bytes": fixture_bytes,
        "projection_bytes": projection_bytes,
        "projection_hash": projection_hash,
    }


def verify_manifest_artifacts(manifest: dict[str, Any]) -> None:
    artifacts = manifest.get("artifact_hashes")
    require(isinstance(artifacts, dict), "bridge manifest artifact_hashes missing")
    for relpath, declared_hash in artifacts.items():
        lexical_path = PROJECT_ROOT / relpath
        require(not lexical_path.is_symlink(), f"manifest artifact cannot be a symlink: {relpath}")
        path = lexical_path.resolve()
        try:
            path.relative_to(PROJECT_ROOT.resolve())
        except ValueError as exc:
            raise ValidationError(f"manifest artifact escapes project root: {relpath}") from exc
        require(path.is_file() and not path.is_symlink(), f"manifest artifact must be a regular file: {relpath}")
        require(sha256_file(path) == declared_hash, f"manifest artifact hash mismatch: {relpath}")
    frozen = manifest.get("frozen_contract_manifest")
    require(isinstance(frozen, dict), "frozen contract manifest receipt missing")
    require(frozen.get("artifact_count") == 11, "frozen contract manifest count must be 11")
    require(frozen.get("artifact_hashes_match") is True, "frozen contract manifest hashes were not verified")
    require(frozen.get("sha256") == EXPECTED_CONTRACT_MANIFEST_SHA256, "frozen contract manifest hash drift")


def run(repeat: int) -> dict[str, Any]:
    require(repeat >= 2, "repeat must be at least 2 for the deterministic gate")
    ensure_safe_output_paths()
    renders = [render_once() for _ in range(repeat)]
    baseline = renders[0]
    require(all(item["fixture_bytes"] == baseline["fixture_bytes"] for item in renders[1:]), "independent reload fixture bytes differ")
    require(all(item["projection_bytes"] == baseline["projection_bytes"] for item in renders[1:]), "independent reload projection bytes differ")
    require(all(item["projection_hash"] == baseline["projection_hash"] for item in renders[1:]), "independent reload projection hash differs")

    atomic_write(OUTPUT_PATH, baseline["fixture_bytes"])
    manifest = build_manifest(
        baseline["mapping"],
        OUTPUT_PATH,
        baseline["fixture_bytes"],
        baseline["projection_hash"],
        repeat,
        baseline["frozen_hashes"],
    )
    atomic_write(MANIFEST_PATH, canonical_text(manifest).encode("utf-8"))
    persisted_manifest = load_json(MANIFEST_PATH)
    verify_manifest_artifacts(persisted_manifest)
    require(persisted_manifest["mapping_version"] == MAPPING_VERSION, "manifest mapping version mismatch")
    require(persisted_manifest["canonical_projection_hash"] == EXPECTED_ACCEPTED_PROJECTION_HASH, "manifest projection hash mismatch")
    require(persisted_manifest["added_at_projection"]["product_decision_required"] is False, "manifest decision flag remains pending")
    require(persisted_manifest["determinism"]["validator_mode"] == "offline_local_generator_validator", "manifest validator mode is ambiguous")
    return {
        "result": "PASS",
        "status": baseline["mapping"]["status"],
        "rows": len(baseline["rows"]),
        "fields": len(baseline["required"]),
        "m3_direct_fields": 33,
        "derived_fields": 6,
        "enabled_false": 59,
        "canonical_projection_hash": baseline["projection_hash"],
        "repeat_count": repeat,
        "independent_reload": True,
        "product_decision_required": baseline["mapping"]["added_at_conflict"]["product_decision_required"],
        "output": str(OUTPUT_PATH),
        "manifest": str(MANIFEST_PATH),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=2, help="deterministic render repetitions; minimum 2")
    parser.add_argument("--require-product-decision", action="store_true", help="return exit 2 while added_at decision remains pending")
    args = parser.parse_args()
    try:
        result = run(args.repeat)
    except ValidationError as exc:
        print(f"SEED_ENRICHMENT_FAIL | {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    if args.require_product_decision and result["product_decision_required"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
