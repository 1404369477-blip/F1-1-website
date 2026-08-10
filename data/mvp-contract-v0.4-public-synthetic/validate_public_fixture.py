#!/usr/bin/env python3
"""Offline validator for the isolated mvp-local-v0.4 public fixture."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SCHEMA_PATH = HERE / "schema.json"
FIXTURE_PATH = HERE / "fixtures.public-synthetic.json"
MANIFEST_PATH = HERE / "manifest.json"
LEDGER_PATH = HERE / "profile-ledger.json"
DTO_MAPPING_PATH = HERE / "public-dto-mapping.json"
PROFILE_BOUNDARY_PATH = HERE / "profile-boundary.json"
STORIES_INPUT_PATH = HERE / "stories.input.json"
V03_FIXTURE_PATH = ROOT / "data/mvp-contract-v0/fixtures.synthetic.json"
V03_MANIFEST_PATH = ROOT / "data/mvp-contract-v0/manifest.json"
M3_SEED_PATH = ROOT / "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json"
M3_MANIFEST_PATH = ROOT / "data/m4-vs0-seed-enrichment-v0/manifest.json"

EXPECTED_V03_MANIFEST_SHA256 = "8a371102c28eaa557d33df8672338cb3aba7b7ae1fe75c0c357c8edaa23b2cde"
EXPECTED_M3_PROJECTION_HASH = "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17"
EXPECTED_COUNTS = {
    "sources": 1, "captured_items": 12, "contents": 12, "events": 0,
    "summaries": 12, "media_candidates": 10, "release_bundles": 12,
    "review_decisions": 12, "publications": 12, "outbox_jobs": 0,
    "published_projections": 12,
}
EPOCHS = ["source_config_epoch", "source_safety_epoch", "authorization_version", "policy_epoch", "recovery_epoch"]
EXPECTED_PROVENANCE = {
    "migration_type": "one_time_reviewed_transfer",
    "source_path": "app/src/features/stories/demo-data.ts",
    "source_sha256": "e6a8fb65374ec71722f8cf0c3234dfdef4ea8df691991d3f6615fdbf6de9881b",
    "transfer_task": "TASK-20260802-EFA8A7",
    "transferred_on": "2026-08-03",
    "runtime_dependency": False,
    "maintenance_source": "data/mvp-contract-v0.4-public-synthetic/stories.input.json",
}
EXPECTED_STORY_KEYS = {
    "slug", "category", "state", "tone", "title", "summary", "lead", "body",
    "key_points", "published_at", "media_description",
}
EXPECTED_ARTIFACT_PATHS = {
    "data/mvp-contract-v0.4-public-synthetic/stories.input.json",
    "data/mvp-contract-v0.4-public-synthetic/schema.json",
    "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json",
    "data/mvp-contract-v0.4-public-synthetic/public-dto-mapping.json",
    "data/mvp-contract-v0.4-public-synthetic/profile-boundary.json",
    "data/mvp-contract-v0.4-public-synthetic/generate_public_fixture.py",
    "data/mvp-contract-v0.4-public-synthetic/validate_public_fixture.py",
}


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant forbidden: {value}")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key forbidden: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    require(path.is_file() and not path.is_symlink(), f"regular file required: {path.relative_to(ROOT)}")
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_json_constant,
        )
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot load JSON {path.relative_to(ROOT)}: {exc}") from exc


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_hash(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def resolve_ref(root_schema: dict[str, Any], ref: str) -> dict[str, Any]:
    require(ref.startswith("#/"), f"only local refs allowed: {ref}")
    value: Any = root_schema
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        require(isinstance(value, dict) and token in value, f"unresolved schema ref: {ref}")
        value = value[token]
    require(isinstance(value, dict), f"schema ref is not an object: {ref}")
    return value


def validate_schema_value(value: Any, rule: dict[str, Any], root_schema: dict[str, Any], path: str) -> None:
    if "$ref" in rule:
        validate_schema_value(value, resolve_ref(root_schema, rule["$ref"]), root_schema, path)
        return
    if "anyOf" in rule:
        failures: list[str] = []
        for branch in rule["anyOf"]:
            try:
                validate_schema_value(value, branch, root_schema, path)
                return
            except ValidationError as exc:
                failures.append(str(exc))
        raise ValidationError(f"{path}: anyOf failed ({' | '.join(failures)})")
    if "const" in rule:
        require(value == rule["const"], f"{path}: const mismatch")
    if "enum" in rule:
        require(value in rule["enum"], f"{path}: enum mismatch {value!r}")

    expected = rule.get("type")
    if expected == "object":
        require(isinstance(value, dict), f"{path}: expected object")
    elif expected == "array":
        require(isinstance(value, list), f"{path}: expected array")
    elif expected == "string":
        require(isinstance(value, str), f"{path}: expected string")
    elif expected == "integer":
        require(isinstance(value, int) and not isinstance(value, bool), f"{path}: expected integer")
    elif expected == "number":
        require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{path}: expected number")
    elif expected == "boolean":
        require(isinstance(value, bool), f"{path}: expected boolean")
    elif expected == "null":
        require(value is None, f"{path}: expected null")

    if isinstance(value, str):
        if "minLength" in rule:
            require(len(value) >= rule["minLength"], f"{path}: below minLength")
        if "maxLength" in rule:
            require(len(value) <= rule["maxLength"], f"{path}: above maxLength")
        if "pattern" in rule:
            require(re.search(rule["pattern"], value) is not None, f"{path}: pattern mismatch")
        if rule.get("format") == "date-time":
            require(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", value) is not None, f"{path}: UTC RFC3339 required")
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValidationError(f"{path}: invalid date-time") from exc
        if rule.get("format") == "date":
            require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None, f"{path}: date required")
        if rule.get("format") == "uri":
            require(re.fullmatch(r"https?://[^\s]+", value) is not None, f"{path}: HTTP(S) URI required")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in rule:
            require(value >= rule["minimum"], f"{path}: below minimum")
        if "maximum" in rule:
            require(value <= rule["maximum"], f"{path}: above maximum")
    if isinstance(value, list):
        if "minItems" in rule:
            require(len(value) >= rule["minItems"], f"{path}: below minItems")
        if "maxItems" in rule:
            require(len(value) <= rule["maxItems"], f"{path}: above maxItems")
        if rule.get("uniqueItems"):
            require(len({canonical_bytes(row) for row in value}) == len(value), f"{path}: duplicate array item")
        if isinstance(rule.get("items"), dict):
            for index, row in enumerate(value):
                validate_schema_value(row, rule["items"], root_schema, f"{path}/{index}")
    if isinstance(value, dict):
        properties = rule.get("properties", {})
        required = set(rule.get("required", []))
        require(required <= set(value), f"{path}: missing required {sorted(required - set(value))}")
        if rule.get("additionalProperties") is False:
            require(set(value) <= set(properties), f"{path}: unknown properties {sorted(set(value) - set(properties))}")
        for key, child in value.items():
            if key in properties:
                validate_schema_value(child, properties[key], root_schema, f"{path}/{key}")
            elif isinstance(rule.get("additionalProperties"), dict):
                validate_schema_value(child, rule["additionalProperties"], root_schema, f"{path}/{key}")


def index_unique(rows: list[dict[str, Any]], key: str, label: str) -> dict[str, dict[str, Any]]:
    values = [row[key] for row in rows]
    require(len(values) == len(set(values)), f"{label}.{key} must be unique")
    return {row[key]: row for row in rows}


def expected_profile_boundary(source_hash: str) -> dict[str, Any]:
    return {
        "boundary_version": "fixture-profile-boundary-v1",
        "decision_inputs": ["U1", "U2"],
        "profiles": {
            "m3-shadow": {
                "sqlite_path": "app/.local/f1plus1.sqlite",
                "contract_version": "mvp-local-v0.3",
                "source_artifact": "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json",
                "source_count": 59,
                "source_field_count": 39,
                "all_enabled_false": True,
                "canonical_projection_hash": EXPECTED_M3_PROJECTION_HASH,
                "public_graph_count": 0,
            },
            "public-synthetic": {
                "sqlite_path": "app/.local/f1plus1-public-synthetic.sqlite",
                "contract_version": "mvp-local-v0.4",
                "source_artifact": "data/mvp-contract-v0/fixtures.synthetic.json#/sources[source_id=src-active]",
                "source_count": 1,
                "source_field_count": 39,
                "source_id_allowlist": ["src-active"],
                "source_delta_from_v0_3": 0,
                "source_canonical_hash": source_hash,
                "public_graph_count": 12,
                "synthetic_only": True,
                "external_calls": 0,
                "writes_to_base": False,
                "real_content_imported": False,
            },
        },
        "process_rules": {
            "exactly_one_profile_per_process": True,
            "sqlite_attach_allowed": False,
            "cross_profile_copy_allowed": False,
            "merge_source_tables_allowed": False,
            "paths_must_be_distinct_regular_local_files": True,
            "implicit_default_allowed": False,
        },
        "import_preconditions": [
            "PROFILE_EXPLICIT_PUBLIC_SYNTHETIC",
            "DB_PATH_EXACT_PUBLIC_SYNTHETIC",
            "ROOT_HASHES_VALID_BEFORE_BEGIN_IMMEDIATE",
            "SOURCE_EXACT_SRC_ACTIVE_NO_M3_IDS",
            "TWELVE_CHAINS_FULLY_VALIDATED",
            "LEDGER_AND_GRAPH_SINGLE_ATOMIC_SEED",
            "SYNTHETIC_ONLY_ZERO_EXTERNAL_IO",
        ],
        "forbidden": [
            "SQLITE_ATTACH_M3_SHADOW",
            "MIX_M3_AND_SRC_ACTIVE",
            "PUBLIC_STORY_TABLE",
            "BASE_WRITE",
            "REAL_PROVIDER_PLATFORM_IO",
            "STATIC_RUNTIME_FALLBACK",
        ],
    }


def expected_dto_mapping() -> dict[str, Any]:
    def field(owner: str, pointer: str, transform: str = "identity") -> dict[str, str]:
        return {"kind": "field", "owner": owner, "json_pointer": pointer, "transform": transform}

    def derived(owner: str, pointer: str, transform: str) -> dict[str, str]:
        return {"kind": "derived", "owner": owner, "json_pointer": pointer, "transform": transform}

    def constant(pointer: str, transform: str) -> dict[str, str]:
        return {"kind": "constant", "owner": "public-synthetic", "json_pointer": pointer, "transform": transform}

    return {
        "mapping_version": "public-read-v0.2-machine-allowlist",
        "query_root": {"kind": "entity", "owner": "PublishedProjection", "json_pointer": "/projection_status", "transform": "require_published"},
        "integrity_gate": {"kind": "gate", "owner": "projection-chain", "json_pointer": "", "transform": "require_exact_approved_hash_fence_chain_before_emit"},
        "feed_item": {
            "publicId": field("Publication", "/public_id", "identity_after_projection_match"),
            "contentType": field("Content", "/editorial_category"),
            "state": derived("ReleaseBundle", "/canonical_payload", "derive_state_access_then_media"),
            "titleZh": field("Summary", "/title_zh"),
            "summaryZh": field("Summary", "/summary_zh"),
            "publishedAt": field("Publication", "/published_at"),
            "sourcePublishedAt": field("ReleaseBundle", "/canonical_payload/time_snapshot/source_published_at"),
            "sourceTimeStatus": field("ReleaseBundle", "/canonical_payload/time_snapshot/source_time_status"),
            "source.sourceId": field("ReleaseBundle", "/canonical_payload/source_snapshot/source_id"),
            "source.platform": field("ReleaseBundle", "/canonical_payload/source_snapshot/platform"),
            "source.displayName": field("ReleaseBundle", "/canonical_payload/source_snapshot/display_name"),
            "source.byline": field("ReleaseBundle", "/canonical_payload/source_snapshot/byline"),
            "source.accessStatus": derived("ReleaseBundle", "/canonical_payload/access_snapshot/content_access_status", "map_available_or_restricted"),
            "media": derived("ReleaseBundle", "/canonical_payload/media_presentation", "allowlisted_synthetic_media_or_null"),
            "originalLink.enabled": constant("/original_link", "const_false"),
            "originalLink.url": constant("/original_link", "const_null"),
            "originalLink.reason": field("ReleaseBundle", "/canonical_payload/access_snapshot/original_link_reason", "allowlist_synthetic_only_or_source_restricted"),
        },
        "detail_extension": {
            "leadZh": field("Summary", "/lead_zh"),
            "bodyZh": field("Summary", "/body_zh"),
            "keyPointsZh": field("Summary", "/key_points_zh"),
        },
        "related_items": {"kind": "derived", "owner": "validated-feed-set", "json_pointer": "", "transform": "same_category_then_global_exclude_self_unique_max3"},
        "ordering": ["Publication.published_at DESC", "PublishedProjection.public_id DESC"],
        "page_size": 12,
        "blocked_pointer_tokens": [
            "canonical_url", "external_url", "source_evidence_url", "original_url",
            "hash", "fence", "epoch", "reviewer", "decision_reason", "raw", "internal",
            "private", "ledger", "evidence_ref",
        ],
    }


def load_story_input() -> list[dict[str, Any]]:
    candidates = sorted(
        path.name for path in HERE.iterdir()
        if path.name.startswith("stories") and path.suffix == ".json"
    )
    require(candidates == ["stories.input.json"], "exactly one data-native stories.input.json is required")
    value = load_json(STORIES_INPUT_PATH)
    require(isinstance(value, dict) and set(value) == {"input_version", "fixture_set", "provenance", "stories"}, "story input root must be closed and exact")
    require(value["input_version"] == "public-demo-stories-input-v1" and value["fixture_set"] == "public-demo-12-v0.4", "story input identity drift")
    require(value["provenance"] == EXPECTED_PROVENANCE, "story input one-time provenance drift")
    stories = value["stories"]
    require(isinstance(stories, list) and len(stories) == 12, "story input must contain exactly 12 rows")
    category_map = {
        "赛事新闻": "race_news",
        "车手社交": "driver_social",
        "名宿/历史": "legends_history",
        "赛场趣事": "paddock_fun",
    }
    slugs: list[str] = []
    state_counts = {"demo": 0, "restricted": 0, "media-missing": 0}
    for index, story in enumerate(stories):
        require(isinstance(story, dict) and set(story) == EXPECTED_STORY_KEYS, f"story input row {index} must be closed and exact")
        require(isinstance(story["slug"], str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", story["slug"]) is not None, f"story input row {index} slug invalid")
        require(story["category"] in category_map, f"story input row {index} category invalid")
        require(story["state"] in state_counts, f"story input row {index} state invalid")
        require(story["tone"] in {"night", "blue", "slate", "violet", "amber"}, f"story input row {index} tone invalid")
        for name in ("title", "summary", "lead", "media_description"):
            require(isinstance(story[name], str) and 1 <= len(story[name]) <= 1200, f"story input row {index} {name} invalid")
        for name in ("body", "key_points"):
            rows = story[name]
            require(isinstance(rows, list) and 1 <= len(rows) <= 8, f"story input row {index} {name} invalid")
            require(all(isinstance(row, str) and 1 <= len(row) <= 1200 for row in rows), f"story input row {index} {name} item invalid")
            require(len(rows) == len(set(rows)), f"story input row {index} {name} duplicate")
        require(isinstance(story["published_at"], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", story["published_at"]) is not None, f"story input row {index} published_at invalid")
        slugs.append(story["slug"])
        state_counts[story["state"]] += 1
    require(len(slugs) == len(set(slugs)), "story input slugs must be unique")
    require(state_counts == {"demo": 8, "restricted": 2, "media-missing": 2}, "story input state counts drift")
    return stories


def verify_frozen_inputs(manifest: dict[str, Any], fixture: dict[str, Any]) -> None:
    require(sha256_file(V03_MANIFEST_PATH) == EXPECTED_V03_MANIFEST_SHA256, "v0.3 manifest hash drift")
    old_manifest = load_json(V03_MANIFEST_PATH)
    declared = manifest["v0_3_frozen"]
    require(declared["manifest_sha256"] == EXPECTED_V03_MANIFEST_SHA256, "successor v0.3 manifest receipt drift")
    require(declared["artifact_count"] == len(old_manifest["artifact_hashes"]) == 11, "v0.3 artifact count drift")
    require(declared["artifact_hashes"] == old_manifest["artifact_hashes"], "successor v0.3 artifact declaration drift")
    for relpath, expected in old_manifest["artifact_hashes"].items():
        require(sha256_file(ROOT / relpath) == expected, f"v0.3 frozen artifact drift: {relpath}")

    m3_manifest = load_json(M3_MANIFEST_PATH)
    m3_seed = load_json(M3_SEED_PATH)
    receipt = manifest["m3_shadow_unchanged"]
    require(m3_manifest["canonical_projection_hash"] == receipt["canonical_projection_hash"] == EXPECTED_M3_PROJECTION_HASH, "M3 projection hash drift")
    require(m3_manifest["row_count"] == receipt["row_count"] == len(m3_seed["rows"]) == 59, "M3 row count drift")
    require(m3_manifest["source_required_field_count"] == receipt["field_count"] == len(m3_seed["fields"]) == 39, "M3 field count drift")
    require(m3_manifest["enabled_false_count"] == receipt["enabled_false_count"] == 59, "M3 enabled=false count drift")
    require(all(row["enabled"] is False for row in m3_seed["rows"]), "M3 source was enabled")
    m3_ids = {row["source_id"] for row in m3_seed["rows"]}
    require(fixture["sources"][0]["source_id"] not in m3_ids, "public-synthetic source mixed with M3 59 rows")

    old_fixture = load_json(V03_FIXTURE_PATH)
    old_source = next(row for row in old_fixture["sources"] if row["source_id"] == "src-active")
    require(fixture["sources"] == [old_source], "src-active must be copied byte-for-byte as a JSON value from v0.3")
    require(manifest["source_delta_from_v0_3"] == 0, "Source delta must stay zero")


def verify_artifacts(manifest: dict[str, Any], fixture: dict[str, Any]) -> None:
    expected_manifest_keys = {
        "manifest_version", "contract_version", "fixture_set", "source_task",
        "successor_of", "status", "artifact_hashes", "manifest_hash_scope",
        "v0_3_frozen", "m3_shadow_unchanged", "story_input", "one_time_provenance",
        "entity_counts", "public_ids", "graph_hash", "source_id",
        "source_delta_from_v0_3", "synthetic_only", "external_calls",
        "writes_to_base", "real_content_imported",
    }
    require(set(manifest) == expected_manifest_keys, "manifest root must be closed and exact")
    require(manifest["manifest_version"] == "public-demo-12-v0.4-manifest-v2", "manifest version drift")
    require(manifest["contract_version"] == "mvp-local-v0.4", "manifest contract drift")
    require(manifest["fixture_set"] == "public-demo-12-v0.4", "manifest fixture set drift")
    require(manifest["source_task"] == "TASK-20260803-D53BF3", "manifest source task drift")
    require(manifest["successor_of"] == "mvp-local-v0.3" and manifest["status"] == "generated_candidate", "manifest lineage/status drift")
    require(
        manifest["manifest_hash_scope"] == "artifact_hashes includes the sole story input and excludes manifest.json/profile-ledger.json to avoid recursion; ledger binds final manifest bytes",
        "manifest hash scope drift",
    )
    require(
        manifest["synthetic_only"] is True
        and manifest["external_calls"] == 0
        and manifest["writes_to_base"] is False
        and manifest["real_content_imported"] is False,
        "manifest capability drift",
    )
    require(manifest["source_id"] == "src-active" and manifest["source_delta_from_v0_3"] == 0, "manifest Source identity drift")
    require(manifest["entity_counts"] == EXPECTED_COUNTS, "manifest entity counts drift")
    require(
        manifest["m3_shadow_unchanged"] == {
            "row_count": 59,
            "field_count": 39,
            "enabled_false_count": 59,
            "canonical_projection_hash": EXPECTED_M3_PROJECTION_HASH,
        },
        "manifest M3 receipt drift",
    )
    require(
        set(manifest["v0_3_frozen"]) == {"manifest_path", "manifest_sha256", "artifact_count", "artifact_hashes"}
        and manifest["v0_3_frozen"]["manifest_path"] == "data/mvp-contract-v0/manifest.json"
        and manifest["v0_3_frozen"]["manifest_sha256"] == EXPECTED_V03_MANIFEST_SHA256
        and manifest["v0_3_frozen"]["artifact_count"] == 11,
        "manifest v0.3 receipt shape drift",
    )
    story_input_hash = sha256_file(STORIES_INPUT_PATH)
    require(
        manifest["story_input"] == {
            "path": "data/mvp-contract-v0.4-public-synthetic/stories.input.json",
            "sha256": story_input_hash,
            "input_version": "public-demo-stories-input-v1",
            "runtime_dependency": False,
        },
        "manifest story input binding drift",
    )
    require(manifest["one_time_provenance"] == EXPECTED_PROVENANCE, "manifest one-time provenance drift")

    require(isinstance(manifest["artifact_hashes"], dict) and set(manifest["artifact_hashes"]) == EXPECTED_ARTIFACT_PATHS, "manifest artifact allowlist drift")
    for relpath, expected in manifest["artifact_hashes"].items():
        target = (ROOT / relpath).resolve()
        try:
            target.relative_to(ROOT.resolve())
        except ValueError as exc:
            raise ValidationError(f"artifact path escapes project: {relpath}") from exc
        require(target.is_file() and not target.is_symlink(), f"manifest artifact missing: {relpath}")
        require(sha256_file(target) == expected, f"manifest artifact hash mismatch: {relpath}")
    require(manifest["artifact_hashes"]["data/mvp-contract-v0.4-public-synthetic/stories.input.json"] == story_input_hash, "manifest story input artifact hash drift")
    require(manifest["graph_hash"] == canonical_hash(fixture), "fixture graph hash mismatch")

    ledger = load_json(LEDGER_PATH)
    expected_ledger = {
        "profile_id": "public-synthetic",
        "sqlite_path": "app/.local/f1plus1-public-synthetic.sqlite",
        "contract_version": "mvp-local-v0.4",
        "fixture_set": "public-demo-12-v0.4",
        "fixture_manifest_hash": sha256_file(MANIFEST_PATH),
        "fixture_graph_hash": manifest["graph_hash"],
        "row_counts": EXPECTED_COUNTS,
        "synthetic_only": True,
        "external_calls": 0,
        "writes_to_base": False,
        "real_content_imported": False,
    }
    require(ledger == expected_ledger, "profile ledger must be closed and exact")

    profile = load_json(PROFILE_BOUNDARY_PATH)
    expected_profile = expected_profile_boundary(canonical_hash(fixture["sources"][0]))
    require(profile == expected_profile, "profile boundary must be closed and exact")
    require(
        profile["profiles"]["public-synthetic"]["sqlite_path"] == ledger["sqlite_path"],
        "profile/ledger SQLite path binding drift",
    )
    require(
        profile["profiles"]["public-synthetic"]["contract_version"] == ledger["contract_version"] == manifest["contract_version"],
        "profile/ledger/manifest contract binding drift",
    )
    require(
        profile["profiles"]["public-synthetic"]["public_graph_count"] == len(fixture["published_projections"]),
        "profile public graph count binding drift",
    )

    dto = load_json(DTO_MAPPING_PATH)
    require(dto == expected_dto_mapping(), "DTO mapping must equal the closed machine allowlist")
    blocked_tokens = tuple(dto["blocked_pointer_tokens"])
    for group in (dto["feed_item"], dto["detail_extension"]):
        for public_field, mapping in group.items():
            require(set(mapping) == {"kind", "owner", "json_pointer", "transform"}, f"DTO mapping shape drift: {public_field}")
            pointer = mapping["json_pointer"].lower()
            require(not any(token in pointer for token in blocked_tokens), f"DTO mapping points to forbidden private field: {public_field}")


def verify_graph(fixture: dict[str, Any], manifest: dict[str, Any]) -> None:
    require(fixture["schema_version"] == "mvp-local-v0.4" and fixture["fixture_set"] == "public-demo-12-v0.4", "fixture identity drift")
    require(fixture["synthetic_only"] is True and fixture["external_calls"] == 0 and fixture["writes_to_base"] is False and fixture["real_content_imported"] is False, "fixture capability drift")
    for key, count in EXPECTED_COUNTS.items():
        require(len(fixture[key]) == count, f"{key} count must be {count}")

    captures = index_unique(fixture["captured_items"], "capture_id", "CapturedItem")
    contents = index_unique(fixture["contents"], "content_id", "Content")
    summaries = index_unique(fixture["summaries"], "summary_id", "Summary")
    media = index_unique(fixture["media_candidates"], "media_candidate_id", "MediaCandidate")
    bundles = index_unique(fixture["release_bundles"], "release_bundle_id", "ReleaseBundle")
    decisions = index_unique(fixture["review_decisions"], "review_decision_id", "ReviewDecision")
    publications = index_unique(fixture["publications"], "publication_id", "Publication")
    projections = index_unique(fixture["published_projections"], "projection_id", "PublishedProjection")
    public_ids = [row["public_id"] for row in fixture["publications"]]
    require(len(public_ids) == len(set(public_ids)) == 12, "public_id uniqueness failed")
    require(all(re.fullmatch(r"public-demo-[a-z0-9-]+", value) for value in public_ids), "public_id must use public-demo-* shape")
    require(public_ids == manifest["public_ids"], "manifest public ID order drift")

    capture_by_content = {row["content_id"]: row for row in captures.values()}
    summary_by_content = {row["content_id"]: row for row in summaries.values()}
    bundle_by_content = {row["content_id"]: row for row in bundles.values()}
    decision_by_bundle = {row["release_bundle_id"]: row for row in decisions.values()}
    publication_by_public = {row["public_id"]: row for row in publications.values()}
    projection_by_public = {row["public_id"]: row for row in projections.values()}
    media_by_content: dict[str, list[dict[str, Any]]] = {}
    for row in media.values():
        media_by_content.setdefault(row["content_id"], []).append(row)

    require(set(capture_by_content) == set(contents), "every Content needs exactly one CapturedItem")
    require(set(summary_by_content) == set(contents), "every Content needs exactly one Summary")
    require(set(bundle_by_content) == set(contents), "every Content needs exactly one ReleaseBundle")
    require(set(publication_by_public) == set(projection_by_public), "Publication/Projection public IDs differ")
    require(len(decision_by_bundle) == 12, "every Bundle needs exactly one decision")

    state_counts = {"available": 0, "restricted": 0, "media_missing": 0}
    for content_id, content in contents.items():
        capture = capture_by_content[content_id]
        summary = summary_by_content[content_id]
        bundle = bundle_by_content[content_id]
        decision = decision_by_bundle[bundle["release_bundle_id"]]
        publication = next(row for row in publications.values() if row["content_id"] == content_id)
        projection = projection_by_public[publication["public_id"]]
        payload = bundle["canonical_payload"]

        require(capture["source_id"] == content["source_id"] == "src-active", f"{content_id}: source FK drift")
        require(capture["content_id"] == content_id and content["capture_id"] == capture["capture_id"], f"{content_id}: capture FK drift")
        require(capture["normalization_status"] == "valid" and capture["dedup_status"] == "unique", f"{content_id}: capture gates not satisfied")
        require(content["content_status"] == "published", f"{content_id}: content not published")
        require(content["content_version_hash"] == canonical_hash(content["content_hash_input"]), f"{content_id}: content hash mismatch")
        require(content["content_hash_input"]["editorial_category"] == content["editorial_category"], f"{content_id}: category hash input mismatch")
        require(content["content_hash_input"]["source_time_status"] == content["source_time_status"], f"{content_id}: time status hash input mismatch")
        require(content["content_hash_input"]["published_at"] == content["published_at"], f"{content_id}: published time hash input mismatch")
        require((content["source_time_status"] == "known" and content["published_at"] is not None) or (content["source_time_status"] == "unknown" and content["published_at"] is None), f"{content_id}: source time invariant")

        require(summary["content_id"] == content_id and summary["input_content_hash"] == content["content_version_hash"], f"{content_id}: summary FK/hash input drift")
        require(summary["summary_status"] == "approved" and summary["summary_version_hash"] == canonical_hash(summary["summary_hash_input"]), f"{content_id}: summary approval/hash mismatch")
        for name in ("lead_zh", "body_zh", "key_points_zh"):
            require(summary[name] == summary["summary_hash_input"][name], f"{content_id}: {name} hash input mismatch")

        expected_content_snapshot = {
            **content["content_hash_input"], "content_version_hash": content["content_version_hash"],
            "capture_id": content["capture_id"], "external_url": content["external_url"], "captured_at": content["captured_at"],
        }
        expected_summary_snapshot = {**summary["summary_hash_input"], "summary_version_hash": summary["summary_version_hash"]}
        require(payload["content_snapshot"] == expected_content_snapshot, f"{content_id}: frozen content snapshot mismatch")
        require(payload["summary_snapshot"] == expected_summary_snapshot, f"{content_id}: frozen summary snapshot mismatch")
        require(payload["source_snapshot"]["source_id"] == "src-active", f"{content_id}: source snapshot drift")
        require(payload["time_snapshot"] == {"source_published_at": content["published_at"], "source_time_status": content["source_time_status"]}, f"{content_id}: time snapshot drift")
        require(bundle["payload_hash"] == canonical_hash(payload), f"{content_id}: payload hash mismatch")
        require(bundle["bundle_hash"] == canonical_hash(bundle["bundle_hash_input"]), f"{content_id}: bundle hash mismatch")
        require(bundle["bundle_hash_input"]["payload_hash"] == bundle["payload_hash"], f"{content_id}: bundle input mismatch")
        require(bundle["immutable"] is True and bundle["release_status"] == "approved", f"{content_id}: bundle not immutable approved")

        selected_media = media_by_content.get(content_id, [])
        presentation = payload["media_presentation"]
        require(bundle["media_refs"] == [row["media_candidate_id"] for row in selected_media], f"{content_id}: media refs mismatch")
        require(payload["media"] == [{"media_candidate_id": row["media_candidate_id"], "media_hash": row["media_hash"], "license_status": row["license_status"], "safety_status": row["safety_status"]} for row in selected_media], f"{content_id}: media snapshot mismatch")
        if presentation["mode"] == "none":
            require(not selected_media and presentation["asset_ref"] is None and presentation["tone"] is None, f"{content_id}: none media invariant")
        else:
            require(presentation["mode"] == "synthetic_placeholder" and len(selected_media) == 1, f"{content_id}: M4 media mode invariant")
            require(presentation["asset_ref"] == selected_media[0]["asset_ref"], f"{content_id}: media asset mismatch")

        access = payload["access_snapshot"]
        if access["content_access_status"] == "source_restricted":
            derived_state = "restricted"
            require(access["original_link_status"] == "disabled_restricted" and access["original_link_reason"] == "source_restricted", f"{content_id}: restricted access mismatch")
        elif presentation["mode"] == "none":
            derived_state = "media_missing"
            require(access["original_link_status"] == "disabled_synthetic" and access["original_link_reason"] == "synthetic_only", f"{content_id}: synthetic link mismatch")
        else:
            derived_state = "available"
            require(access["original_link_status"] == "disabled_synthetic" and access["original_link_reason"] == "synthetic_only", f"{content_id}: synthetic link mismatch")
        state_counts[derived_state] += 1
        require(access["original_link_status"] != "available", f"{content_id}: real original link must remain disabled")

        require(decision["content_id"] == content_id and decision["summary_id"] == summary["summary_id"], f"{content_id}: decision FK mismatch")
        require(decision["decision"] == "approved" and decision["approved_bundle_hash"] == bundle["bundle_hash"], f"{content_id}: decision approval binding mismatch")
        expected_decision_hash_input = {
            "review_decision_id": decision["review_decision_id"],
            "release_bundle_id": decision["release_bundle_id"],
            "approved_bundle_hash": decision["approved_bundle_hash"],
            "review_version": decision["review_version"],
            "decision": decision["decision"],
            "canonical_json_rule_version": decision["canonical_json_rule_version"],
            "source_config_epoch": decision["source_config_epoch"],
            "source_safety_epoch": decision["source_safety_epoch"],
            "authorization_version": decision["authorization_version"],
            "policy_epoch": decision["policy_epoch"],
            "recovery_epoch": decision["recovery_epoch"],
        }
        require(decision["decision_hash_input"] == expected_decision_hash_input, f"{content_id}: decision hash input does not exactly match top-level approval/fences")
        require(decision["decision_hash"] == canonical_hash(decision["decision_hash_input"]), f"{content_id}: decision hash mismatch")
        require(publication["release_bundle_id"] == bundle["release_bundle_id"], f"{content_id}: publication bundle FK mismatch")
        require(publication["publication_status"] == "published" and publication["published_at"] is not None and publication["emergency_stop"] is False, f"{content_id}: publication state mismatch")
        require(publication["approved_bundle_hash"] == bundle["bundle_hash"], f"{content_id}: publication bundle hash mismatch")
        require(publication["approved_content_version_hash"] == content["content_version_hash"] and publication["approved_summary_version_hash"] == summary["summary_version_hash"], f"{content_id}: publication version hash mismatch")
        require(projection["content_id"] == content_id and projection["summary_id"] == summary["summary_id"] and projection["release_bundle_id"] == bundle["release_bundle_id"], f"{content_id}: projection FK mismatch")
        require(projection["published_version_hash"] == publication["published_version_hash"] and projection["projection_status"] == "published", f"{content_id}: projection version/state mismatch")
        require(projection["synthetic_only"] is True and projection["external_calls"] == 0, f"{content_id}: projection capability drift")

        fence_rows = [bundle, decision, publication, payload["fences"]]
        for epoch in EPOCHS:
            values = [row[epoch] for row in fence_rows]
            require(values == [1, 1, 1, 1], f"{content_id}: fence mismatch {epoch}")

    require(state_counts == {"available": 8, "restricted": 2, "media_missing": 2}, f"derived state counts drift: {state_counts}")
    ordered = sorted(publications.values(), key=lambda row: (row["published_at"], row["public_id"]), reverse=True)
    require([row["public_id"] for row in ordered] == manifest["public_ids"], "publication order differs from manifest/UI transfer order")


def verify_story_input_projection(
    stories: list[dict[str, Any]], fixture: dict[str, Any], manifest: dict[str, Any]
) -> None:
    category_map = {
        "赛事新闻": "race_news",
        "车手社交": "driver_social",
        "名宿/历史": "legends_history",
        "赛场趣事": "paddock_fun",
    }
    contents = {row["content_id"]: row for row in fixture["contents"]}
    summaries = {row["content_id"]: row for row in fixture["summaries"]}
    bundles = {row["content_id"]: row for row in fixture["release_bundles"]}
    publications = {row["content_id"]: row for row in fixture["publications"]}
    expected_public_ids = [f"public-demo-{story['slug']}" for story in stories]
    require(manifest["public_ids"] == expected_public_ids, "manifest public IDs must derive exactly from the sole story input")
    for story in stories:
        slug = story["slug"]
        content_id = f"content-demo-{slug}"
        require(content_id in contents and content_id in summaries and content_id in bundles and content_id in publications, f"story input projection missing: {slug}")
        content = contents[content_id]
        summary = summaries[content_id]
        bundle = bundles[content_id]
        publication = publications[content_id]
        payload = bundle["canonical_payload"]
        require(publication["public_id"] == f"public-demo-{slug}", f"story input public ID drift: {slug}")
        require(
            content["editorial_category"] == category_map[story["category"]]
            and content["normalized_title"] == story["title"]
            and content["normalized_body"] == "\n\n".join(story["body"])
            and content["published_at"] == story["published_at"],
            f"story input Content projection drift: {slug}",
        )
        require(
            summary["title_zh"] == story["title"]
            and summary["summary_zh"] == story["summary"]
            and summary["lead_zh"] == story["lead"]
            and summary["body_zh"] == story["body"]
            and summary["key_points_zh"] == story["key_points"],
            f"story input Summary projection drift: {slug}",
        )
        presentation = payload["media_presentation"]
        access = payload["access_snapshot"]
        require(presentation["alt_zh"] == story["media_description"], f"story input media description drift: {slug}")
        if story["state"] == "media-missing":
            require(presentation["mode"] == "none" and presentation["tone"] is None, f"story input media-missing projection drift: {slug}")
        else:
            require(presentation["mode"] == "synthetic_placeholder" and presentation["tone"] == story["tone"], f"story input media projection drift: {slug}")
        if story["state"] == "restricted":
            require(access["content_access_status"] == "source_restricted", f"story input restricted projection drift: {slug}")
        else:
            require(access["content_access_status"] == "available", f"story input access projection drift: {slug}")


def main() -> int:
    try:
        schema = load_json(SCHEMA_PATH)
        fixture = load_json(FIXTURE_PATH)
        manifest = load_json(MANIFEST_PATH)
        stories = load_story_input()
        validate_schema_value(fixture, schema, schema, "fixture")
        ledger = load_json(LEDGER_PATH)
        validate_schema_value(ledger, schema["$defs"]["FixtureProfileLedger"], schema, "profile-ledger")
        require(set(schema["$defs"]) >= {"Source", "CapturedItem", "Content", "Event", "Summary", "MediaCandidate", "ReleaseBundle", "ReviewDecision", "Publication", "OutboxJob", "PublishedProjection", "SnapshotReconciliation", "FixtureCase"}, "v0.4 must retain all 13 v0.3 domain definitions")
        verify_artifacts(manifest, fixture)
        verify_frozen_inputs(manifest, fixture)
        verify_graph(fixture, manifest)
        verify_story_input_projection(stories, fixture, manifest)
    except ValidationError as exc:
        print(f"PUBLIC_FIXTURE_V04_FAIL | {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "result": "PASS", "contract_version": "mvp-local-v0.4", "fixture_set": "public-demo-12-v0.4",
        "source_count": 1, "captured_items": 12, "contents": 12, "summaries": 12,
        "media_candidates": 10, "release_bundles": 12, "review_decisions": 12,
        "publications": 12, "published_projections": 12, "public_ids_valid": 12,
        "v0_3_artifacts_unchanged": 11, "m3_rows": 59, "m3_fields": 39,
        "m3_projection_hash": EXPECTED_M3_PROJECTION_HASH, "external_calls": 0, "writes_to_base": False,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
