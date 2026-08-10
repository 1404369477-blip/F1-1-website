#!/usr/bin/env python3
"""Generate the offline mvp-local-v0.4 public-synthetic successor package.

The generator reads one data-native story input plus frozen v0.3/M3 artifacts.
It performs no network, provider, Base, media, AI, publication, or app runtime
I/O. Every output is written through a no-follow, same-directory atomic replace.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import stat
import uuid
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).absolute()
OUT = SCRIPT.parent
ROOT = SCRIPT.parents[2]
V03 = ROOT / "data/mvp-contract-v0"
V03_SCHEMA = V03 / "schema.json"
V03_FIXTURE = V03 / "fixtures.synthetic.json"
V03_MANIFEST = V03 / "manifest.json"
M3_SEED_MANIFEST = ROOT / "data/m4-vs0-seed-enrichment-v0/manifest.json"
STORIES_INPUT = OUT / "stories.input.json"

CONTRACT_VERSION = "mvp-local-v0.4"
FIXTURE_SET = "public-demo-12-v0.4"
CANONICAL_RULE = "canonical-json-v1"
SOURCE_ID = "src-active"
PROFILE_ID = "public-synthetic"
ACTOR = "synthetic:system"
REVIEWER = "synthetic:reviewer-public-demo"
EXPECTED_V03_MANIFEST_SHA256 = "8a371102c28eaa557d33df8672338cb3aba7b7ae1fe75c0c357c8edaa23b2cde"
EXPECTED_M3_PROJECTION_HASH = "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17"

EXPECTED_INPUT_KEYS = {"input_version", "fixture_set", "provenance", "stories"}
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
OUTPUT_JSON_NAMES = {
    "schema.json", "fixtures.public-synthetic.json", "public-dto-mapping.json",
    "profile-boundary.json", "manifest.json", "profile-ledger.json",
}

CANONICAL_RULE_SPEC = {
    "version": CANONICAL_RULE,
    "encoding": "UTF-8",
    "key_order": "lexicographic Unicode code-point order",
    "whitespace": "compact JSON separators comma=',' and colon=':'",
    "numbers": "finite JSON numbers only; no NaN, Infinity or exponent rewriting",
    "nulls": "preserve explicit null values; never omit a present null",
    "unicode": "preserve Unicode code points with ensure_ascii=false; no NFC/NFD normalization",
    "hash": "SHA-256 over the exact compact UTF-8 byte sequence",
    "rfc8785": "project-defined canonical JSON; not RFC 8785 JCS",
}

CATEGORY_MAP = {
    "赛事新闻": "race_news",
    "车手社交": "driver_social",
    "名宿/历史": "legends_history",
    "赛场趣事": "paddock_fun",
}



def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_hash(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant forbidden: {value}")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key forbidden: {key}")
        result[key] = value
    return result


def load_regular_json(path: Path) -> Any:
    try:
        entry = path.lstat()
    except OSError as exc:
        raise SystemExit(f"required regular input unavailable: {path.name}") from exc
    if stat.S_ISLNK(entry.st_mode) or not stat.S_ISREG(entry.st_mode):
        raise SystemExit(f"required regular input unavailable: {path.name}")
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_json_constant,
        )
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid JSON input: {path.name}") from exc


def load_story_input() -> list[dict[str, Any]]:
    try:
        candidates = sorted(
            path.name for path in OUT.iterdir()
            if path.name.startswith("stories") and path.suffix == ".json"
        )
    except OSError as exc:
        raise SystemExit("story input directory is unavailable") from exc
    if candidates != ["stories.input.json"]:
        raise SystemExit("exactly one data-native stories.input.json is required")
    value = load_regular_json(STORIES_INPUT)
    if not isinstance(value, dict) or set(value) != EXPECTED_INPUT_KEYS:
        raise SystemExit("story input root must be closed and exact")
    if value["input_version"] != "public-demo-stories-input-v1" or value["fixture_set"] != FIXTURE_SET:
        raise SystemExit("story input identity drifted")
    if value["provenance"] != EXPECTED_PROVENANCE:
        raise SystemExit("story input one-time provenance drifted")
    stories = value["stories"]
    if not isinstance(stories, list) or len(stories) != 12:
        raise SystemExit("story input must contain exactly 12 rows")

    slugs: list[str] = []
    state_counts = {"demo": 0, "restricted": 0, "media-missing": 0}
    for index, story in enumerate(stories):
        if not isinstance(story, dict) or set(story) != EXPECTED_STORY_KEYS:
            raise SystemExit(f"story input row {index} must be closed and exact")
        if not isinstance(story["slug"], str) or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", story["slug"]) is None:
            raise SystemExit(f"story input row {index} has invalid slug")
        if story["category"] not in CATEGORY_MAP:
            raise SystemExit(f"story input row {index} has invalid category")
        if story["state"] not in state_counts:
            raise SystemExit(f"story input row {index} has invalid state")
        if story["tone"] not in {"night", "blue", "slate", "violet", "amber"}:
            raise SystemExit(f"story input row {index} has invalid tone")
        for name in ("title", "summary", "lead", "media_description"):
            if not isinstance(story[name], str) or not story[name] or len(story[name]) > 1200:
                raise SystemExit(f"story input row {index} has invalid {name}")
        for name, maximum in (("body", 8), ("key_points", 8)):
            rows = story[name]
            if not isinstance(rows, list) or not 1 <= len(rows) <= maximum:
                raise SystemExit(f"story input row {index} has invalid {name}")
            if any(not isinstance(row, str) or not row or len(row) > 1200 for row in rows):
                raise SystemExit(f"story input row {index} has invalid {name} item")
            if len(rows) != len(set(rows)):
                raise SystemExit(f"story input row {index} has duplicate {name} item")
        if not isinstance(story["published_at"], str) or re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", story["published_at"]
        ) is None:
            raise SystemExit(f"story input row {index} has invalid published_at")
        slugs.append(story["slug"])
        state_counts[story["state"]] += 1
    if len(slugs) != len(set(slugs)):
        raise SystemExit("story input slug must be unique")
    if state_counts != {"demo": 8, "restricted": 2, "media-missing": 2}:
        raise SystemExit("story input state counts drifted")
    return stories


def assert_safe_output_directory() -> int:
    expected_out = ROOT / "data/mvp-contract-v0.4-public-synthetic"
    if OUT != expected_out:
        raise SystemExit("output directory is outside the fixed project boundary")
    for path in (ROOT, ROOT / "data", OUT):
        try:
            entry = path.lstat()
        except OSError as exc:
            raise SystemExit("output parent chain is unavailable") from exc
        if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
            raise SystemExit("output parent chain must contain only real directories")
    try:
        script_entry = SCRIPT.lstat()
    except OSError as exc:
        raise SystemExit("generator must be a regular file") from exc
    if stat.S_ISLNK(script_entry.st_mode) or not stat.S_ISREG(script_entry.st_mode):
        raise SystemExit("generator must be a regular file")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        return os.open(OUT, flags)
    except OSError as exc:
        raise SystemExit("output directory cannot be opened without following links") from exc


def write_json(path: Path, value: object) -> str:
    if path.parent != OUT or path.name not in OUTPUT_JSON_NAMES:
        raise SystemExit("output target is outside the closed output allowlist")
    payload = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    directory_fd = assert_safe_output_directory()
    temporary_name = f".{path.name}.{uuid.uuid4().hex}.tmp"
    temporary_fd: int | None = None
    try:
        try:
            existing = os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None and not stat.S_ISREG(existing.st_mode):
            raise SystemExit(f"output target must be a regular file: {path.name}")

        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        temporary_fd = os.open(temporary_name, flags, 0o600, dir_fd=directory_fd)
        remaining = memoryview(payload)
        while remaining:
            written = os.write(temporary_fd, remaining)
            if written <= 0:
                raise OSError("short write")
            remaining = remaining[written:]
        os.fsync(temporary_fd)
        os.close(temporary_fd)
        temporary_fd = None
        os.replace(
            temporary_name,
            path.name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        os.fsync(directory_fd)
    except OSError as exc:
        raise SystemExit(f"atomic output write failed: {path.name}") from exc
    finally:
        if temporary_fd is not None:
            os.close(temporary_fd)
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        finally:
            os.close(directory_fd)
    return hashlib.sha256(payload).hexdigest()


def audit(at: str, actor: str = ACTOR) -> dict[str, Any]:
    return {"created_at": at, "updated_at": at, "created_by_ref": actor, "updated_by_ref": actor}


def nullable_string(*, pattern: str | None = None, max_length: int | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"type": "string"}
    if pattern is not None:
        item["pattern"] = pattern
    if max_length is not None:
        item["maxLength"] = max_length
    return {"anyOf": [item, {"type": "null"}]}


def exact_array(ref: str, count: int) -> dict[str, Any]:
    return {"type": "array", "items": {"$ref": ref}, "minItems": count, "maxItems": count}


def build_schema() -> dict[str, Any]:
    old = load_regular_json(V03_SCHEMA)
    defs = copy.deepcopy(old["$defs"])

    content = defs["Content"]
    content_fields = {
        "editorial_category": {"type": "string", "enum": list(CATEGORY_MAP.values())},
        "source_time_status": {"type": "string", "enum": ["known", "unknown"]},
    }
    for name, field_schema in content_fields.items():
        content["properties"][name] = copy.deepcopy(field_schema)
        content["required"].insert(content["required"].index("content_status"), name)
        content["properties"]["content_hash_input"]["properties"][name] = copy.deepcopy(field_schema)
        content["properties"]["content_hash_input"]["required"].insert(
            content["properties"]["content_hash_input"]["required"].index("content_version"), name
        )
    content_hash = content["properties"]["content_hash_input"]
    content_hash["properties"]["published_at"] = copy.deepcopy(content["properties"]["published_at"])
    content_hash["required"].insert(content_hash["required"].index("content_version"), "published_at")

    summary = defs["Summary"]
    summary_fields = {
        "lead_zh": {"type": "string", "minLength": 1, "maxLength": 400},
        "body_zh": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 1200}, "minItems": 1, "maxItems": 8},
        "key_points_zh": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 240}, "minItems": 1, "maxItems": 8, "uniqueItems": True},
    }
    for name, field_schema in summary_fields.items():
        summary["properties"][name] = copy.deepcopy(field_schema)
        summary["required"].insert(summary["required"].index("summary_status"), name)
        summary["properties"]["summary_hash_input"]["properties"][name] = copy.deepcopy(field_schema)
        summary["properties"]["summary_hash_input"]["required"].insert(
            summary["properties"]["summary_hash_input"]["required"].index("language"), name
        )

    bundle_payload = defs["ReleaseBundle"]["properties"]["canonical_payload"]
    content_snapshot = bundle_payload["properties"]["content_snapshot"]
    for name in ("editorial_category", "source_time_status"):
        content_snapshot["properties"][name] = copy.deepcopy(content["properties"][name])
        content_snapshot["required"].insert(content_snapshot["required"].index("content_version"), name)
    summary_snapshot = bundle_payload["properties"]["summary_snapshot"]
    for name, field_schema in summary_fields.items():
        summary_snapshot["properties"][name] = copy.deepcopy(field_schema)
        summary_snapshot["required"].insert(summary_snapshot["required"].index("language"), name)
    source_snapshot = bundle_payload["properties"]["source_snapshot"]
    source_snapshot["properties"]["display_name"] = {"type": "string", "minLength": 1, "maxLength": 120}
    source_snapshot["properties"]["byline"] = {"type": "string", "minLength": 1, "maxLength": 120}
    source_snapshot["required"].extend(["display_name", "byline"])
    bundle_payload["properties"]["access_snapshot"] = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "content_access_status": {"type": "string", "enum": ["available", "source_restricted"]},
            "original_link_status": {"type": "string", "enum": ["disabled_synthetic", "disabled_restricted", "available"]},
            "original_link_reason": {"type": "string", "enum": ["synthetic_only", "source_restricted", "verified_available"]},
        },
        "required": ["content_access_status", "original_link_status", "original_link_reason"],
    }
    bundle_payload["properties"]["time_snapshot"] = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "source_published_at": {"anyOf": [{"type": "string", "format": "date-time"}, {"type": "null"}]},
            "source_time_status": {"type": "string", "enum": ["known", "unknown"]},
        },
        "required": ["source_published_at", "source_time_status"],
    }
    bundle_payload["properties"]["media_presentation"] = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "mode": {"type": "string", "enum": ["synthetic_placeholder", "none", "image"]},
            "asset_ref": nullable_string(pattern=r"^synthetic:[a-z0-9._:-]+$"),
            "alt_zh": {"type": "string", "minLength": 1, "maxLength": 300},
            "caption_zh": nullable_string(max_length=300),
            "credit_display": nullable_string(max_length=120),
            "tone": {"anyOf": [{"type": "string", "enum": ["night", "blue", "amber", "violet", "slate"]}, {"type": "null"}]},
        },
        "required": ["mode", "asset_ref", "alt_zh", "caption_zh", "credit_display", "tone"],
    }
    for name in ("access_snapshot", "time_snapshot", "media_presentation"):
        bundle_payload["required"].append(name)
    bundle_payload["properties"]["schema"]["properties"]["domain_schema_version"] = {"const": CONTRACT_VERSION}

    profile_ledger = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "profile_id": {"const": PROFILE_ID},
            "sqlite_path": {"const": "app/.local/f1plus1-public-synthetic.sqlite"},
            "contract_version": {"const": CONTRACT_VERSION},
            "fixture_set": {"const": FIXTURE_SET},
            "fixture_manifest_hash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "fixture_graph_hash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "row_counts": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
            "synthetic_only": {"const": True},
            "external_calls": {"const": 0},
            "writes_to_base": {"const": False},
            "real_content_imported": {"const": False},
        },
        "required": ["profile_id", "sqlite_path", "contract_version", "fixture_set", "fixture_manifest_hash", "fixture_graph_hash", "row_counts", "synthetic_only", "external_calls", "writes_to_base", "real_content_imported"],
    }
    defs["FixtureProfileLedger"] = profile_ledger

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:f1plus1:public-synthetic:mvp-local-v0.4",
        "title": "F1+1 mvp-local-v0.4 public-synthetic successor",
        "description": "Isolated local synthetic public read-model fixture; 13 v0.3 domain definitions are retained and v0.4 fields are added without mutating v0.3.",
        "type": "object", "additionalProperties": False,
        "properties": {
            "schema_version": {"const": CONTRACT_VERSION},
            "fixture_set": {"const": FIXTURE_SET},
            "canonical_json_rule_version": {"const": CANONICAL_RULE},
            "canonical_json_rule": copy.deepcopy(old["properties"]["canonical_json_rule"]),
            "synthetic_only": {"const": True}, "external_calls": {"const": 0},
            "writes_to_base": {"const": False}, "real_content_imported": {"const": False},
            "sources": exact_array("#/$defs/Source", 1),
            "captured_items": exact_array("#/$defs/CapturedItem", 12),
            "contents": exact_array("#/$defs/Content", 12),
            "events": exact_array("#/$defs/Event", 0),
            "summaries": exact_array("#/$defs/Summary", 12),
            "media_candidates": exact_array("#/$defs/MediaCandidate", 10),
            "release_bundles": exact_array("#/$defs/ReleaseBundle", 12),
            "review_decisions": exact_array("#/$defs/ReviewDecision", 12),
            "publications": exact_array("#/$defs/Publication", 12),
            "outbox_jobs": exact_array("#/$defs/OutboxJob", 0),
            "published_projections": exact_array("#/$defs/PublishedProjection", 12),
            "snapshot_reconciliation": exact_array("#/$defs/SnapshotReconciliation", 0),
            "cases": exact_array("#/$defs/FixtureCase", 0),
        },
        "required": ["schema_version", "fixture_set", "canonical_json_rule_version", "canonical_json_rule", "synthetic_only", "external_calls", "writes_to_base", "real_content_imported", "sources", "captured_items", "contents", "events", "summaries", "media_candidates", "release_bundles", "review_decisions", "publications", "outbox_jobs", "published_projections", "snapshot_reconciliation", "cases"],
        "$defs": defs,
    }


def build_graph(source: dict[str, Any], stories: list[dict[str, Any]]) -> dict[str, Any]:
    captures: list[dict[str, Any]] = []
    contents: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    media: list[dict[str, Any]] = []
    bundles: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    publications: list[dict[str, Any]] = []
    projections: list[dict[str, Any]] = []

    for story in stories:
        slug = story["slug"]
        at = story["published_at"]
        capture_id = f"cap-demo-{slug}"
        content_id = f"content-demo-{slug}"
        summary_id = f"summary-demo-{slug}"
        media_id = f"media-demo-{slug}"
        bundle_id = f"bundle-demo-{slug}"
        decision_id = f"decision-demo-{slug}"
        publication_id = f"publication-demo-{slug}"
        public_id = f"public-demo-{slug}"
        projection_id = f"projection-demo-{slug}"
        internal_url = f"https://synthetic.invalid/public-demo/{slug}"
        evidence_url = f"https://synthetic.invalid/evidence/public-demo/{slug}"

        captures.append({
            "capture_id": capture_id, "raw_url": internal_url, "capture_note": "SYNTHETIC_ONLY: imported from the local UI demo input",
            "captured_at": at, "normalization_status": "valid", "normalization_error": None,
            "dedup_status": "unique", "dedup_match_source_id": None, "source_id": SOURCE_ID,
            "canonical_url": internal_url, "content_id": content_id, "source_config_epoch": 1, **audit(at),
        })
        content_hash_input = {
            "content_id": content_id, "source_id": SOURCE_ID,
            "external_content_id": f"synthetic-public-demo-{slug}", "canonical_url": internal_url,
            "content_kind": "post", "editorial_category": CATEGORY_MAP[story["category"]],
            "source_time_status": "known", "published_at": at, "content_version": "v1",
            "normalized_title": story["title"], "normalized_body": "\n\n".join(story["body"]),
            "language": "zh-CN", "source_evidence_url": evidence_url, "source_config_epoch": 1,
        }
        content_hash = canonical_hash(content_hash_input)
        content = {
            "content_id": content_id, "source_id": SOURCE_ID, "capture_id": capture_id,
            "external_content_id": content_hash_input["external_content_id"], "external_url": internal_url,
            "canonical_url": internal_url, "content_kind": "post",
            "editorial_category": content_hash_input["editorial_category"], "source_time_status": "known",
            "content_status": "published", "published_at": at, "captured_at": at, "content_version": "v1",
            "content_version_hash": content_hash, "content_hash_input": content_hash_input,
            "normalized_title": story["title"], "normalized_body": content_hash_input["normalized_body"],
            "language": "zh-CN", "source_evidence_url": evidence_url, "source_config_epoch": 1, **audit(at),
        }
        contents.append(content)

        summary_hash_input = {
            "summary_id": summary_id, "content_id": content_id, "summary_version": "v1",
            "title_zh": story["title"], "summary_zh": story["summary"], "lead_zh": story["lead"],
            "body_zh": story["body"], "key_points_zh": story["key_points"], "language": "zh-CN",
            "source_evidence_url": evidence_url, "input_content_hash": content_hash,
            "summary_schema_version": "summary-schema-v2", "summarizer": "synthetic:ui-demo-transfer-v1", "deterministic": True,
        }
        summary_hash = canonical_hash(summary_hash_input)
        summary = {
            "summary_id": summary_id, "content_id": content_id, "summary_version": "v1",
            "summary_version_hash": summary_hash, "summary_hash_input": summary_hash_input,
            "input_content_hash": content_hash, "summary_schema_version": "summary-schema-v2",
            "summarizer": "synthetic:ui-demo-transfer-v1", "deterministic": True,
            "title_zh": story["title"], "summary_zh": story["summary"], "lead_zh": story["lead"],
            "body_zh": story["body"], "key_points_zh": story["key_points"], "summary_status": "approved",
            "language": "zh-CN", "source_evidence_url": evidence_url, **audit(at),
        }
        summaries.append(summary)

        media_rows: list[dict[str, Any]] = []
        if story["state"] != "media-missing":
            asset_ref = f"synthetic:public-demo-{slug}"
            media_row = {
                "media_candidate_id": media_id, "content_id": content_id, "asset_ref": asset_ref,
                "media_hash": hashlib.sha256(f"synthetic:media:{slug}".encode("utf-8")).hexdigest(),
                "mime_type": "image/png", "license_status": "allowed", "safety_status": "passed",
                "candidate_status": "selected", **audit(at),
            }
            media.append(media_row)
            media_rows.append(media_row)

        restricted = story["state"] == "restricted"
        media_presentation = {
            "mode": "none" if story["state"] == "media-missing" else "synthetic_placeholder",
            "asset_ref": None if story["state"] == "media-missing" else media_rows[0]["asset_ref"],
            "alt_zh": story["media_description"], "caption_zh": None,
            "credit_display": None if story["state"] == "media-missing" else "F1+1 本地合成占位",
            "tone": None if story["state"] == "media-missing" else story["tone"],
        }
        media_snapshot = [{
            "media_candidate_id": row["media_candidate_id"], "media_hash": row["media_hash"],
            "license_status": row["license_status"], "safety_status": row["safety_status"],
        } for row in media_rows]
        canonical_payload = {
            "release_bundle_id": bundle_id, "content_version_hash": content_hash, "summary_version_hash": summary_hash,
            "content_snapshot": {**content_hash_input, "content_version_hash": content_hash, "capture_id": capture_id, "external_url": internal_url, "captured_at": at},
            "summary_snapshot": {**summary_hash_input, "summary_version_hash": summary_hash},
            "source_snapshot": {
                "source_id": SOURCE_ID, "canonical_url": source["canonical_url"], "platform": source["platform"],
                "identity_status": source["identity_status"], "source_config_epoch": 1, "source_safety_epoch": 1,
                "display_name": "本地合成演示资料", "byline": "F1+1 演示编辑台",
            },
            "original_url": internal_url,
            "rights": {"rights_status": "allowed", "evidence_ref": f"synthetic:rights-public-demo-{slug}"},
            "media": media_snapshot,
            "policy": {"policy_epoch": 1, "publication_mode": "manual_only", "manual_review_required": True, "safety_rule_version": "safety-rule-v1"},
            "schema": {"domain_schema_version": CONTRACT_VERSION, "payload_schema_version": "release-payload-v2", "canonical_json_rule_version": CANONICAL_RULE},
            "fences": {"source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1},
            "access_snapshot": {
                "content_access_status": "source_restricted" if restricted else "available",
                "original_link_status": "disabled_restricted" if restricted else "disabled_synthetic",
                "original_link_reason": "source_restricted" if restricted else "synthetic_only",
            },
            "time_snapshot": {"source_published_at": at, "source_time_status": "known"},
            "media_presentation": media_presentation,
        }
        payload_hash = canonical_hash(canonical_payload)
        bundle_hash_input = {
            "release_bundle_id": bundle_id, "bundle_version": "v1", "payload_hash": payload_hash,
            "canonical_json_rule_version": CANONICAL_RULE, "immutable": True,
        }
        bundle_hash = canonical_hash(bundle_hash_input)
        bundle = {
            "release_bundle_id": bundle_id, "bundle_version": "v1", "content_id": content_id, "summary_id": summary_id,
            "content_version_hash": content_hash, "summary_version_hash": summary_hash, "source_evidence_url": evidence_url,
            "canonical_json_rule_version": CANONICAL_RULE, "canonical_payload": canonical_payload,
            "payload_hash": payload_hash, "bundle_hash_input": bundle_hash_input, "bundle_hash": bundle_hash,
            "release_status": "approved", "immutable": True, "assembled_at": at,
            "media_refs": [row["media_candidate_id"] for row in media_rows],
            "source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1,
            "policy_epoch": 1, "recovery_epoch": 1, **audit(at),
        }
        bundles.append(bundle)
        decision_hash_input = {
            "review_decision_id": decision_id, "release_bundle_id": bundle_id,
            "approved_bundle_hash": bundle_hash, "review_version": 1, "decision": "approved",
            "canonical_json_rule_version": CANONICAL_RULE, "source_config_epoch": 1,
            "source_safety_epoch": 1, "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1,
        }
        decisions.append({
            "review_decision_id": decision_id, "content_id": content_id, "summary_id": summary_id,
            "release_bundle_id": bundle_id, "review_version": 1, "decision": "approved",
            "approved_bundle_hash": bundle_hash, "reviewer_ref": REVIEWER, "reviewed_at": at,
            "decision_reason": "SYNTHETIC_ONLY: local demo bundle explicitly approved for the isolated public fixture",
            "decision_hash_input": decision_hash_input, "decision_hash": canonical_hash(decision_hash_input),
            "canonical_json_rule_version": CANONICAL_RULE, "immutable": True,
            "source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1,
            "policy_epoch": 1, "recovery_epoch": 1, **audit(at, REVIEWER),
        })
        published_version_hash = hashlib.sha256(f"synthetic:published:{publication_id}:v1".encode("utf-8")).hexdigest()
        publications.append({
            "publication_id": publication_id, "content_id": content_id, "summary_id": summary_id,
            "release_bundle_id": bundle_id, "public_id": public_id, "publish_generation": 1,
            "publication_status": "published", "approved_bundle_hash": bundle_hash,
            "approved_content_version_hash": content_hash, "approved_summary_version_hash": summary_hash,
            "published_version_hash": published_version_hash,
            "idempotency_key": f"publish:{publication_id}:bundle:{bundle_hash}",
            "reconcile_key": f"reconcile:{publication_id}:{bundle_hash}", "reconcile_status": "not_needed",
            "reconcile_attempt": 0, "last_query_at": None, "emergency_stop": False, "attempt": 1,
            "last_error_code": None, "published_at": at, "source_evidence_url": evidence_url,
            "source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1,
            "policy_epoch": 1, "recovery_epoch": 1, **audit(at),
        })
        projections.append({
            "projection_id": projection_id, "public_id": public_id, "content_id": content_id,
            "summary_id": summary_id, "release_bundle_id": bundle_id, "publish_generation": 1,
            "projection_status": "published", "published_version_hash": published_version_hash,
            "source_evidence_url": evidence_url, "synthetic_only": True, "external_calls": 0, **audit(at),
        })

    return {
        "schema_version": CONTRACT_VERSION, "fixture_set": FIXTURE_SET,
        "canonical_json_rule_version": CANONICAL_RULE, "canonical_json_rule": CANONICAL_RULE_SPEC,
        "synthetic_only": True, "external_calls": 0, "writes_to_base": False, "real_content_imported": False,
        "sources": [source], "captured_items": captures, "contents": contents, "events": [],
        "summaries": summaries, "media_candidates": media, "release_bundles": bundles,
        "review_decisions": decisions, "publications": publications, "outbox_jobs": [],
        "published_projections": projections, "snapshot_reconciliation": [], "cases": [],
    }


def build_profile_boundary(source_hash: str) -> dict[str, Any]:
    return {
        "boundary_version": "fixture-profile-boundary-v1", "decision_inputs": ["U1", "U2"],
        "profiles": {
            "m3-shadow": {
                "sqlite_path": "app/.local/f1plus1.sqlite", "contract_version": "mvp-local-v0.3",
                "source_artifact": "data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json",
                "source_count": 59, "source_field_count": 39, "all_enabled_false": True,
                "canonical_projection_hash": EXPECTED_M3_PROJECTION_HASH, "public_graph_count": 0,
            },
            PROFILE_ID: {
                "sqlite_path": "app/.local/f1plus1-public-synthetic.sqlite", "contract_version": CONTRACT_VERSION,
                "source_artifact": "data/mvp-contract-v0/fixtures.synthetic.json#/sources[source_id=src-active]",
                "source_count": 1, "source_field_count": 39, "source_id_allowlist": [SOURCE_ID],
                "source_delta_from_v0_3": 0, "source_canonical_hash": source_hash,
                "public_graph_count": 12, "synthetic_only": True, "external_calls": 0,
                "writes_to_base": False, "real_content_imported": False,
            },
        },
        "process_rules": {
            "exactly_one_profile_per_process": True, "sqlite_attach_allowed": False,
            "cross_profile_copy_allowed": False, "merge_source_tables_allowed": False,
            "paths_must_be_distinct_regular_local_files": True, "implicit_default_allowed": False,
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
            "SQLITE_ATTACH_M3_SHADOW", "MIX_M3_AND_SRC_ACTIVE", "PUBLIC_STORY_TABLE",
            "BASE_WRITE", "REAL_PROVIDER_PLATFORM_IO", "STATIC_RUNTIME_FALLBACK",
        ],
    }


def build_dto_mapping() -> dict[str, Any]:
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


def main() -> None:
    stories = load_story_input()
    if sha256_file(V03_MANIFEST) != EXPECTED_V03_MANIFEST_SHA256:
        raise SystemExit("frozen v0.3 manifest drifted")
    v03_manifest = load_regular_json(V03_MANIFEST)
    m3_manifest = load_regular_json(M3_SEED_MANIFEST)
    if m3_manifest.get("canonical_projection_hash") != EXPECTED_M3_PROJECTION_HASH:
        raise SystemExit("M3 59x39 projection hash drifted")
    old_fixture = load_regular_json(V03_FIXTURE)
    source = next(row for row in old_fixture["sources"] if row["source_id"] == SOURCE_ID)

    schema = build_schema()
    graph = build_graph(copy.deepcopy(source), stories)
    dto_mapping = build_dto_mapping()
    profile_boundary = build_profile_boundary(canonical_hash(source))

    artifact_hashes: dict[str, str] = {}
    story_input_relpath = str(STORIES_INPUT.relative_to(ROOT))
    artifact_hashes[story_input_relpath] = sha256_file(STORIES_INPUT)
    paths_and_values = [
        (OUT / "schema.json", schema),
        (OUT / "fixtures.public-synthetic.json", graph),
        (OUT / "public-dto-mapping.json", dto_mapping),
        (OUT / "profile-boundary.json", profile_boundary),
    ]
    for path, value in paths_and_values:
        artifact_hashes[str(path.relative_to(ROOT))] = write_json(path, value)
    for filename in ("generate_public_fixture.py", "validate_public_fixture.py"):
        path = OUT / filename
        artifact_hashes[str(path.relative_to(ROOT))] = sha256_file(path)

    entity_counts = {name: len(graph[name]) for name in (
        "sources", "captured_items", "contents", "events", "summaries", "media_candidates",
        "release_bundles", "review_decisions", "publications", "outbox_jobs", "published_projections",
    )}
    manifest = {
        "manifest_version": "public-demo-12-v0.4-manifest-v2", "contract_version": CONTRACT_VERSION,
        "fixture_set": FIXTURE_SET, "source_task": "TASK-20260803-D53BF3",
        "successor_of": "mvp-local-v0.3", "status": "generated_candidate",
        "artifact_hashes": artifact_hashes,
        "manifest_hash_scope": "artifact_hashes includes the sole story input and excludes manifest.json/profile-ledger.json to avoid recursion; ledger binds final manifest bytes",
        "v0_3_frozen": {"manifest_path": "data/mvp-contract-v0/manifest.json", "manifest_sha256": EXPECTED_V03_MANIFEST_SHA256, "artifact_count": 11, "artifact_hashes": v03_manifest["artifact_hashes"]},
        "m3_shadow_unchanged": {"row_count": 59, "field_count": 39, "enabled_false_count": 59, "canonical_projection_hash": EXPECTED_M3_PROJECTION_HASH},
        "story_input": {"path": story_input_relpath, "sha256": artifact_hashes[story_input_relpath], "input_version": "public-demo-stories-input-v1", "runtime_dependency": False},
        "one_time_provenance": EXPECTED_PROVENANCE,
        "entity_counts": entity_counts,
        "public_ids": [f"public-demo-{row['slug']}" for row in stories],
        "graph_hash": canonical_hash(graph), "source_id": SOURCE_ID, "source_delta_from_v0_3": 0,
        "synthetic_only": True, "external_calls": 0, "writes_to_base": False, "real_content_imported": False,
    }
    manifest_path = OUT / "manifest.json"
    write_json(manifest_path, manifest)
    ledger = {
        "profile_id": PROFILE_ID, "sqlite_path": "app/.local/f1plus1-public-synthetic.sqlite",
        "contract_version": CONTRACT_VERSION, "fixture_set": FIXTURE_SET,
        "fixture_manifest_hash": sha256_file(manifest_path), "fixture_graph_hash": manifest["graph_hash"],
        "row_counts": entity_counts, "synthetic_only": True, "external_calls": 0,
        "writes_to_base": False, "real_content_imported": False,
    }
    write_json(OUT / "profile-ledger.json", ledger)
    print(json.dumps({"result": "GENERATED", "contract_version": CONTRACT_VERSION, "public_ids": 12, "graph_hash": manifest["graph_hash"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
