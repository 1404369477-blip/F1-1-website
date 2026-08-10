#!/usr/bin/env python3
"""Validate the complete DATA-MM-01 runtime graph and deterministic roots."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GRAPH_NAME = "runtime-graph.public-multimedia-synthetic.json"
MANIFEST_NAME = "runtime-profile-manifest.json"
GENERATOR_PATH = HERE / "generate_runtime_graph.py"
V04_VALIDATOR_PATH = ROOT / "data/mvp-contract-v0.4-public-synthetic/validate_public_fixture.py"
V04_SCHEMA_PATH = ROOT / "data/mvp-contract-v0.4-public-synthetic/schema.json"
V05_SCHEMA_PATH = HERE / "schema.json"
V05_FIXTURE_PATH = HERE / "fixtures.multimedia-synthetic.json"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in output, f"duplicate JSON key: {key}")
        output[key] = value
    return output


def load_json(path: Path) -> Any:
    require(path.is_file() and not path.is_symlink(), f"regular non-symlink file required: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot parse {path}: {exc}") from exc


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_input_dir(raw: str | None) -> Path:
    target = HERE if raw is None else Path(raw).resolve()
    require(target.is_dir() and not target.is_symlink(), "input directory must be an existing regular directory")
    tmp_root = Path("/tmp").resolve()
    require(target == HERE or target == tmp_root or tmp_root in target.parents, "input directory must be package directory or /tmp descendant")
    return target


def unique_index(rows: list[dict[str, Any]], key: str, label: str) -> dict[str, dict[str, Any]]:
    values = [row[key] for row in rows]
    require(len(values) == len(set(values)), f"{label}.{key} must be unique")
    return {row[key]: row for row in rows}


def validate_entity_shapes(graph: dict[str, Any], v04_schema: dict[str, Any], v05_schema: dict[str, Any], schema_validator: Any) -> None:
    mapping = {
        "sources": "Source", "captured_items": "CapturedItem", "contents": "Content", "summaries": "Summary",
        "media_candidates": "MediaCandidate", "review_decisions": "ReviewDecision", "publications": "Publication",
        "published_projections": "PublishedProjection",
    }
    for array_name, def_name in mapping.items():
        rule = v04_schema["$defs"][def_name]
        for index, row in enumerate(graph[array_name]):
            schema_validator(row, rule, v04_schema, f"/{array_name}/{index}")
    presentation_rule = v05_schema["$defs"]["CanonicalMediaPresentationV2"]
    for index, bundle in enumerate(graph["release_bundles"]):
        base_bundle = copy.deepcopy(bundle)
        presentations = base_bundle["canonical_payload"].pop("media_presentations")
        schema_validator(base_bundle, v04_schema["$defs"]["ReleaseBundle"], v04_schema, f"/release_bundles/{index}")
        require(0 <= len(presentations) <= 4, f"bundle {bundle['release_bundle_id']}: presentation count must be 0..4")
        for presentation_index, presentation in enumerate(presentations):
            schema_validator(presentation, presentation_rule, v05_schema, f"/release_bundles/{index}/canonical_payload/media_presentations/{presentation_index}")


def validate_graph(graph: dict[str, Any], v04_schema: dict[str, Any], v05_schema: dict[str, Any], v05_fixture: dict[str, Any], schema_validator: Any, generator: Any) -> None:
    expected_root_keys = {
        "runtime_graph_version", "profile_id", "sqlite_path", "contract_version", "fixture_set",
        "canonical_json_rule_version", "canonical_json_rule", "seed_order", "row_counts", "synthetic_only",
        "external_calls", "writes_to_base", "real_content_imported", "real_media", *generator.ROW_COUNT_KEYS,
        "expected_dto_cases", "profile_ledger_seed_contract",
    }
    require(set(graph) == expected_root_keys, "runtime graph root must be closed")
    require(graph["runtime_graph_version"] == "public-multimedia-runtime-graph-v0.1", "runtime graph version drift")
    require(graph["profile_id"] == generator.PROFILE_ID and graph["sqlite_path"] == generator.SQLITE_PATH, "profile/path drift")
    require(graph["contract_version"] == generator.CONTRACT_VERSION and graph["fixture_set"] == generator.FIXTURE_SET, "contract/fixture drift")
    require(graph["canonical_json_rule_version"] == "canonical-json-v1", "canonical rule drift")
    require(graph["synthetic_only"] is True and graph["external_calls"] == 0 and graph["writes_to_base"] is False and graph["real_content_imported"] is False and graph["real_media"] == 0, "runtime graph safety boundary drift")
    require(graph["seed_order"] == list(generator.ROW_COUNT_KEYS), "seed order drift")
    actual_counts = {key: len(graph[key]) for key in generator.ROW_COUNT_KEYS}
    expected_counts = {"sources": 1, "captured_items": 3, "contents": 3, "events": 0, "summaries": 3, "media_candidates": 5, "release_bundles": 3, "review_decisions": 3, "publications": 3, "outbox_jobs": 0, "published_projections": 3}
    require(actual_counts == graph["row_counts"] == expected_counts, "runtime row counts drift")
    validate_entity_shapes(graph, v04_schema, v05_schema, schema_validator)

    sources = unique_index(graph["sources"], "source_id", "Source")
    captures = unique_index(graph["captured_items"], "capture_id", "CapturedItem")
    contents = unique_index(graph["contents"], "content_id", "Content")
    summaries = unique_index(graph["summaries"], "summary_id", "Summary")
    media = unique_index(graph["media_candidates"], "media_candidate_id", "MediaCandidate")
    bundles = unique_index(graph["release_bundles"], "release_bundle_id", "ReleaseBundle")
    decisions = unique_index(graph["review_decisions"], "review_decision_id", "ReviewDecision")
    publications = unique_index(graph["publications"], "publication_id", "Publication")
    projections = unique_index(graph["published_projections"], "projection_id", "PublishedProjection")
    require(len({row["public_id"] for row in publications.values()}) == 3 and len({row["public_id"] for row in projections.values()}) == 3, "public_id must be unique")
    require(len({row["release_bundle_id"] for row in publications.values()}) == 3 and len({row["release_bundle_id"] for row in projections.values()}) == 3, "one Publication/Projection per Bundle required")

    frozen_cases = {row["case_id"]: row for row in v05_fixture["cases"]}
    dto_cases = {row["case_id"]: row for row in graph["expected_dto_cases"]}
    require(set(dto_cases) == {"case-zero", "case-single", "case-gallery"}, "DTO case set drift")
    require([dto_cases[name]["media_count"] for name in ("case-zero", "case-single", "case-gallery")] == [0, 1, 4], "0/1/4 media coverage drift")

    for content in contents.values():
        require(content["source_id"] in sources and content["capture_id"] in captures, f"Content FK drift: {content['content_id']}")
        require(content["content_version_hash"] == canonical_hash(content["content_hash_input"]), f"Content hash drift: {content['content_id']}")
        capture = captures[content["capture_id"]]
        require(capture["content_id"] == content["content_id"] and capture["source_id"] == content["source_id"], f"CapturedItem FK drift: {content['content_id']}")
    for summary in summaries.values():
        require(summary["content_id"] in contents, f"Summary FK drift: {summary['summary_id']}")
        require(summary["summary_version_hash"] == canonical_hash(summary["summary_hash_input"]), f"Summary hash drift: {summary['summary_id']}")
        require(summary["input_content_hash"] == contents[summary["content_id"]]["content_version_hash"], f"Summary input hash drift: {summary['summary_id']}")

    per_content_media: dict[str, int] = {}
    for item in media.values():
        require(item["content_id"] in contents, f"MediaCandidate FK drift: {item['media_candidate_id']}")
        require(item["asset_ref"].startswith("synthetic:") and "://" not in item["asset_ref"], f"external media ref forbidden: {item['media_candidate_id']}")
        require(item["candidate_status"] == "selected" and item["license_status"] == "allowed" and item["safety_status"] == "passed", f"media rights/safety drift: {item['media_candidate_id']}")
        expected_media_hash = canonical_hash({"asset_ref": item["asset_ref"], "fixture_set": "public-multimedia-synthetic-v0.1", "mime_type": item["mime_type"]})
        require(item["media_hash"] == expected_media_hash, f"media hash drift: {item['media_candidate_id']}")
        per_content_media[item["content_id"]] = per_content_media.get(item["content_id"], 0) + 1
    require(sorted(per_content_media.get(content_id, 0) for content_id in contents) == [0, 1, 4], "per-content media cardinality must be 0/1/4")
    require(max(per_content_media.values()) == 4, "four candidates on one Content required")

    for bundle in bundles.values():
        require(bundle["content_id"] in contents and bundle["summary_id"] in summaries, f"Bundle FK drift: {bundle['release_bundle_id']}")
        content = contents[bundle["content_id"]]; summary = summaries[bundle["summary_id"]]
        payload = bundle["canonical_payload"]
        require(bundle["content_version_hash"] == content["content_version_hash"] == payload["content_version_hash"], f"Bundle content hash drift: {bundle['release_bundle_id']}")
        require(bundle["summary_version_hash"] == summary["summary_version_hash"] == payload["summary_version_hash"], f"Bundle summary hash drift: {bundle['release_bundle_id']}")
        require(bundle["payload_hash"] == canonical_hash(payload), f"payload hash drift: {bundle['release_bundle_id']}")
        expected_bundle_input = {"release_bundle_id": bundle["release_bundle_id"], "bundle_version": bundle["bundle_version"], "payload_hash": bundle["payload_hash"], "canonical_json_rule_version": bundle["canonical_json_rule_version"], "immutable": True}
        require(bundle["bundle_hash_input"] == expected_bundle_input and bundle["bundle_hash"] == canonical_hash(expected_bundle_input), f"bundle hash drift: {bundle['release_bundle_id']}")
        refs = bundle["media_refs"]; snapshots = payload["media"]; presentations = payload["media_presentations"]
        require(0 <= len(refs) <= 4 and len(refs) == len(set(refs)) == len(snapshots) == len(presentations), f"media list count/order drift: {bundle['release_bundle_id']}")
        for index, media_id in enumerate(refs):
            require(media_id in media and media[media_id]["content_id"] == bundle["content_id"], f"media ref FK drift: {bundle['release_bundle_id']}:{index}")
            require(snapshots[index]["media_candidate_id"] == presentations[index]["media_candidate_id"] == media_id, f"media identity/order drift: {bundle['release_bundle_id']}:{index}")
            require(snapshots[index]["media_hash"] == media[media_id]["media_hash"] and snapshots[index]["license_status"] == "allowed" and snapshots[index]["safety_status"] == "passed", f"media snapshot drift: {bundle['release_bundle_id']}:{index}")

    decision_by_bundle = {row["release_bundle_id"]: row for row in decisions.values()}
    publication_by_bundle = {row["release_bundle_id"]: row for row in publications.values()}
    projection_by_bundle = {row["release_bundle_id"]: row for row in projections.values()}
    require(len(decision_by_bundle) == len(publication_by_bundle) == len(projection_by_bundle) == 3, "unique chain per Bundle required")
    for bundle_id, bundle in bundles.items():
        decision = decision_by_bundle[bundle_id]; publication = publication_by_bundle[bundle_id]; projection = projection_by_bundle[bundle_id]
        require(decision["decision"] == "approved" and decision["approved_bundle_hash"] == bundle["bundle_hash"], f"Decision approval drift: {bundle_id}")
        require(decision["decision_hash"] == canonical_hash(decision["decision_hash_input"]), f"Decision hash drift: {bundle_id}")
        require(publication["publication_status"] == "published" and publication["approved_bundle_hash"] == bundle["bundle_hash"], f"Publication drift: {bundle_id}")
        require(publication["approved_content_version_hash"] == bundle["content_version_hash"] and publication["approved_summary_version_hash"] == bundle["summary_version_hash"], f"Publication version hash drift: {bundle_id}")
        expected_published_hash = canonical_hash({"approved_bundle_hash": publication["approved_bundle_hash"], "approved_content_version_hash": publication["approved_content_version_hash"], "approved_summary_version_hash": publication["approved_summary_version_hash"], "public_id": publication["public_id"], "publish_generation": publication["publish_generation"], "release_bundle_id": bundle_id})
        require(publication["published_version_hash"] == expected_published_hash, f"published hash drift: {bundle_id}")
        require(projection["projection_status"] == "published" and projection["public_id"] == publication["public_id"] and projection["publish_generation"] == publication["publish_generation"] and projection["published_version_hash"] == publication["published_version_hash"], f"Projection drift: {bundle_id}")

    media_rule = v05_schema["$defs"]["PublicMediaItemV2"]
    item_rule = v05_schema["$defs"]["PublicFeedItemV2"]
    detail_rule = v05_schema["$defs"]["PublicStoryDetailV2"]
    for case_id, expected in dto_cases.items():
        frozen = frozen_cases[case_id]
        v2_item = expected["expected_v2_item"]
        schema_validator(v2_item, item_rule, v05_schema, f"/expected_dto_cases/{case_id}/expected_v2_item")
        detail = {**copy.deepcopy(v2_item), **copy.deepcopy(expected["expected_detail_extension"])}
        schema_validator(detail, detail_rule, v05_schema, f"/expected_dto_cases/{case_id}/expected_detail")
        for media_index, media_item in enumerate(v2_item["media"]):
            schema_validator(media_item, media_rule, v05_schema, f"/expected_dto_cases/{case_id}/media/{media_index}")
        require(v2_item["media"] == frozen["expected_media_v2"], f"V2 expected media differs from ACK fixture: {case_id}")
        v1_item = expected["expected_v1_item"]
        require(set(v1_item) == set(v2_item) and v1_item["media"] == frozen["expected_media_v1"], f"V1 down-conversion drift: {case_id}")
        require({key: value for key, value in v1_item.items() if key != "media"} == {key: value for key, value in v2_item.items() if key != "media"}, f"non-media V1/V2 drift: {case_id}")

    ledger = graph["profile_ledger_seed_contract"]
    require(ledger["static"]["row_counts"] == graph["row_counts"], "profile ledger row counts drift")
    require(set(ledger["runtime_bindings"]) == {"fixture_manifest_hash", "fixture_graph_hash", "manifest_root_sha256", "generator_root_sha256", "validator_root_sha256", "migration_selector_root_sha256", "schema_fingerprint_sha256"}, "profile ledger runtime binding set drift")
    require(ledger["row_counts_json_rule"] == "canonical-json-v1(row_counts)", "row_counts_json rule drift")


def validate_manifest(manifest: dict[str, Any], graph: dict[str, Any], graph_path: Path, manifest_path: Path, generator: Any) -> None:
    require(manifest["runtime_manifest_version"] == "public-multimedia-runtime-manifest-v0.1", "runtime manifest version drift")
    require(manifest["profile_id"] == generator.PROFILE_ID and manifest["contract_version"] == generator.CONTRACT_VERSION, "runtime manifest identity drift")
    require(manifest["synthetic_only"] is True and manifest["external_calls"] == 0 and manifest["real_media"] == 0 and manifest["writes_to_base"] is False and manifest["real_content_imported"] is False, "manifest safety boundary drift")
    without_root = {key: value for key, value in manifest.items() if key != "runtime_manifest_root_sha256"}
    require(manifest["runtime_manifest_root_sha256"] == canonical_hash(without_root), "runtime manifest root drift")
    require(manifest["runtime_graph_file_sha256"] == file_hash(graph_path), "runtime graph file hash drift")
    require(manifest["runtime_graph_canonical_sha256"] == canonical_hash(graph), "runtime graph canonical hash drift")
    require(manifest["row_counts"] == graph["row_counts"], "manifest row counts drift")
    require(manifest["generator_root_sha256"] == file_hash(GENERATOR_PATH), "generator root drift")
    require(manifest["validator_root_sha256"] == file_hash(Path(__file__).resolve()), "validator root drift")
    require(manifest["frozen_input_hashes"] == generator.FROZEN_INPUTS, "frozen input map drift")
    require(manifest["artifact_hashes"] == {**generator.FROZEN_V05_ARTIFACTS, f"data/mvp-contract-v0.5-public-multimedia-synthetic/{GRAPH_NAME}": file_hash(graph_path), "data/mvp-contract-v0.5-public-multimedia-synthetic/generate_runtime_graph.py": file_hash(GENERATOR_PATH), "data/mvp-contract-v0.5-public-multimedia-synthetic/validate_runtime_graph.py": file_hash(Path(__file__).resolve())}, "manifest artifact map drift")
    require(f"data/mvp-contract-v0.5-public-multimedia-synthetic/{MANIFEST_NAME}" not in manifest["artifact_hashes"], "runtime manifest must not self-hash")
    receipt_input = {"scope": "DATA-MM-01-clean-generation-validation-v1", "runtime_graph_file_sha256": manifest["runtime_graph_file_sha256"], "runtime_graph_canonical_sha256": manifest["runtime_graph_canonical_sha256"], "row_counts": manifest["row_counts"], "generator_root_sha256": manifest["generator_root_sha256"], "validator_root_sha256": manifest["validator_root_sha256"], "frozen_input_hashes": manifest["frozen_input_hashes"]}
    expected_receipt = canonical_hash(receipt_input)
    require(manifest["generator_receipt"] == manifest["validator_receipt"] == expected_receipt, "execution receipt drift")
    expected_manifest = generator.build_manifest(graph, graph_path)
    require(manifest == expected_manifest, "runtime manifest differs from generator")
def validate_once(input_dir: Path) -> tuple[str, str, str, str]:
    generator = load_module(GENERATOR_PATH, "runtime_graph_generator")
    v04_validator = load_module(V04_VALIDATOR_PATH, "v04_fixture_validator")
    graph_path = input_dir / GRAPH_NAME
    manifest_path = input_dir / MANIFEST_NAME
    graph = load_json(graph_path); manifest = load_json(manifest_path)
    v04_schema = load_json(V04_SCHEMA_PATH); v05_schema = load_json(V05_SCHEMA_PATH); v05_fixture = load_json(V05_FIXTURE_PATH)
    generator.verify_frozen()
    validate_graph(graph, v04_schema, v05_schema, v05_fixture, v04_validator.validate_schema_value, generator)
    validate_manifest(manifest, graph, graph_path, manifest_path, generator)
    ledger_binding_receipt = canonical_hash({
        "profile_ledger_static": graph["profile_ledger_seed_contract"]["static"],
        "fixture_manifest_hash": file_hash(manifest_path),
        "fixture_graph_hash": manifest["runtime_graph_canonical_sha256"],
        "manifest_root_sha256": manifest["runtime_manifest_root_sha256"],
        "generator_root_sha256": manifest["generator_root_sha256"],
        "validator_root_sha256": manifest["validator_root_sha256"],
        "deferred_exact_bindings": ["migration_selector_root_sha256", "schema_fingerprint_sha256"],
        "profile_ledger_root_rule": graph["profile_ledger_seed_contract"]["profile_ledger_root_rule"],
    })
    return manifest["validator_receipt"], manifest["runtime_graph_canonical_sha256"], manifest["runtime_manifest_root_sha256"], ledger_binding_receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir")
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    require(1 <= args.repeat <= 10, "repeat must be 1..10")
    input_dir = safe_input_dir(args.input_dir)
    receipts = [validate_once(input_dir) for _ in range(args.repeat)]
    require(len(set(receipts)) == 1, "independent reload receipt/root drift")
    receipt, graph_root, manifest_root, ledger_binding = receipts[0]
    print(f"DATA_MM_01_VALIDATION_OK receipt={receipt} graph={graph_root} manifest={manifest_root} ledger_binding={ledger_binding} repeat={args.repeat} external_calls=0")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"DATA_MM_01_VALIDATION_FAIL: {exc}")
        raise SystemExit(1)
