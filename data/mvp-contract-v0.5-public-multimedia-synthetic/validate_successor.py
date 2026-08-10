#!/usr/bin/env python3
"""Offline semantic validator for public-read-v0.2 multimedia successor."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GENERATOR = HERE / "generate_successor.py"
SCHEMA = HERE / "schema.json"
MAPPING = HERE / "public-multimedia-mapping.json"
FIXTURE = HERE / "fixtures.multimedia-synthetic.json"
MANIFEST = HERE / "manifest.json"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in output, f"duplicate JSON key: {key}")
        output[key] = value
    return output


def load(path: Path) -> Any:
    require(path.is_file() and not path.is_symlink(), f"regular non-symlink file required: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot parse {path.relative_to(ROOT)}: {exc}") from exc


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def chash(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def fhash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generator_module():
    spec = importlib.util.spec_from_file_location("multimedia_generator", GENERATOR)
    require(spec is not None and spec.loader is not None, "cannot load generator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_schema(schema: dict[str, Any]) -> None:
    require(schema["$id"] == "urn:f1plus1:public-read:v0.2-multimedia-synthetic", "schema id drift")
    media = schema["$defs"]["PublicMediaItemV2"]
    require(media["additionalProperties"] is False, "media item must be closed")
    require(set(media["required"]) == {"kind", "mediaId", "assetRef", "mediaHash", "altZh", "captionZh", "creditDisplay", "tone"}, "media item field set drift")
    item_media = schema["$defs"]["PublicFeedItemV2"]["properties"]["media"]
    require(item_media["minItems"] == 0 and item_media["maxItems"] == 4 and item_media["uniqueItems"] is True, "media cardinality/order contract drift")
    presentation = schema["$defs"]["CanonicalMediaPresentationV2"]
    require(presentation["additionalProperties"] is False and set(presentation["required"]) == {"media_candidate_id", "alt_zh", "caption_zh", "credit_display", "tone"}, "canonical presentation snapshot drift")
    frozen_media = schema["$defs"]["CanonicalMediaSnapshotV2"]
    require(frozen_media["properties"]["license_status"]["const"] == "allowed" and frozen_media["properties"]["safety_status"]["const"] == "passed", "canonical rights/safety guard drift")
    detail = schema["$defs"]["PublicStoryDetailV2"]
    require({"leadZh", "bodyZh", "keyPointsZh"} <= set(detail["required"]), "detail successor must preserve V1 extension")
    page = schema["$defs"]["PublicPageV1Compatible"]
    require(page["additionalProperties"] is False and set(page["required"]) == {"pageSize", "hasMore", "nextCursor"}, "page compatibility drift")


def validate_mapping(mapping: dict[str, Any]) -> None:
    require(mapping["mapping_version"] == "public-multimedia-mapping-v0.1", "mapping version drift")
    require(mapping["classification"] == "proposed_public_dto_successor_not_domain_schema", "mapping classification drift")
    require(mapping["entity_additions"] == [], "new entity forbidden")
    require(mapping["domain_chain"] == ["MediaCandidate", "ReleaseBundle", "ReviewDecision", "Publication", "PublishedProjection"], "domain chain drift")
    require(mapping["successor"]["media_cardinality"] == "0..4", "successor cardinality drift")
    require(mapping["successor"]["array_order"] == "ReleaseBundle.media_refs order", "row order must come from media_refs")
    require(set(mapping["item_mapping"]) == {"media[].mediaId", "media[].assetRef", "media[].mediaHash", "media[].altZh", "media[].captionZh", "media[].creditDisplay", "media[].tone"}, "mapping slot set drift")
    compat = mapping["api_compatibility"]
    require(compat["v2_response"].startswith("schemaVersion public-read-v0.2"), "v2 response version missing")
    require("first item" in compat["v1_down_conversion"], "v1 first-item compatibility missing")
    require(compat["integrity_failure"] == {"http": 500, "reasonCode": "PUBLIC_READ_INTEGRITY_FAILED"}, "integrity error drift")
    require(mapping["external_calls"] == 0 and mapping["real_media"] == 0 and mapping["writes_to_base"] is False, "mapping safety boundary drift")


def validate_case(row: dict[str, Any], expected_count: int) -> None:
    candidates = row["media_candidates"]
    bundle = row["release_bundle"]
    payload = bundle["canonical_payload"]
    refs = bundle["media_refs"]
    snapshots = payload["media"]
    presentations = payload["media_presentations"]
    output = row["expected_media_v2"]
    require(len(candidates) == len(refs) == len(snapshots) == len(presentations) == len(output) == expected_count, f"{row['case_id']}: media count mismatch")
    require(len(refs) == len(set(refs)), f"{row['case_id']}: duplicate media ref")
    candidate_by_id = {item["media_candidate_id"]: item for item in candidates}
    require(len(candidate_by_id) == len(candidates), f"{row['case_id']}: duplicate candidate id")
    for index, media_id in enumerate(refs):
        candidate = candidate_by_id[media_id]
        snapshot = snapshots[index]
        presentation = presentations[index]
        dto = output[index]
        require(snapshot["media_candidate_id"] == presentation["media_candidate_id"] == dto["mediaId"] == media_id, f"{row['case_id']}: identity/order mismatch")
        require(candidate["media_hash"] == snapshot["media_hash"] == dto["mediaHash"], f"{row['case_id']}: media hash mismatch")
        expected_asset_hash = chash({"asset_ref": candidate["asset_ref"], "fixture_set": "public-multimedia-synthetic-v0.1", "mime_type": candidate["mime_type"]})
        require(candidate["media_hash"] == expected_asset_hash, f"{row['case_id']}: synthetic asset hash not recomputable")
        require(candidate["asset_ref"].startswith("synthetic:") and "://" not in candidate["asset_ref"], f"{row['case_id']}: external asset forbidden")
        require(candidate["candidate_status"] == "selected" and candidate["license_status"] == snapshot["license_status"] == "allowed", f"{row['case_id']}: rights fail closed")
        require(candidate["safety_status"] == snapshot["safety_status"] == "passed", f"{row['case_id']}: safety fail closed")
        require(dto["assetRef"] == candidate["asset_ref"] and dto["altZh"] == presentation["alt_zh"] and dto["creditDisplay"] == presentation["credit_display"] and dto["tone"] == presentation["tone"], f"{row['case_id']}: presentation mapping mismatch")
        require(set(dto) == {"kind", "mediaId", "assetRef", "mediaHash", "altZh", "captionZh", "creditDisplay", "tone"}, f"{row['case_id']}: public media DTO must be closed")
        require(dto["kind"] == "synthetic_placeholder" and dto["tone"] in {"night", "blue", "amber", "violet", "slate"}, f"{row['case_id']}: public media enum drift")
        require(1 <= len(dto["altZh"]) <= 300 and (dto["creditDisplay"] is None or len(dto["creditDisplay"]) <= 120), f"{row['case_id']}: presentation length drift")
    require(payload["media_snapshot_hash"] == chash({"media": snapshots, "media_presentations": presentations}), f"{row['case_id']}: snapshot hash mismatch")
    require(bundle["payload_hash"] == chash(payload), f"{row['case_id']}: payload hash mismatch")
    require(bundle["bundle_hash_input"] == {"release_bundle_id": bundle["release_bundle_id"], "bundle_version": bundle["bundle_version"], "payload_hash": bundle["payload_hash"], "canonical_json_rule_version": bundle["canonical_json_rule_version"], "immutable": True}, f"{row['case_id']}: bundle hash input drift")
    require(bundle["bundle_hash"] == chash(bundle["bundle_hash_input"]), f"{row['case_id']}: bundle hash mismatch")
    require(row["review_decision"]["approved_bundle_hash"] == row["publication"]["approved_bundle_hash"] == bundle["bundle_hash"], f"{row['case_id']}: approved hash chain mismatch")
    publication = row["publication"]; projection = row["published_projection"]
    require(publication["publication_status"] == projection["projection_status"] == "published", f"{row['case_id']}: projection must derive from published")
    require(publication["public_id"] == projection["public_id"] and publication["publish_generation"] == projection["publish_generation"] and publication["published_version_hash"] == projection["published_version_hash"], f"{row['case_id']}: projection identity/hash mismatch")
    expected_published_hash = chash({"approved_bundle_hash": publication["approved_bundle_hash"], "approved_content_version_hash": publication["approved_content_version_hash"], "approved_summary_version_hash": publication["approved_summary_version_hash"], "public_id": publication["public_id"], "publish_generation": publication["publish_generation"], "release_bundle_id": bundle["release_bundle_id"]})
    require(publication["published_version_hash"] == expected_published_hash, f"{row['case_id']}: published version hash mismatch")
    require(row["expected_media_v1"] is (None if expected_count == 0 else row["expected_media_v1"]), f"{row['case_id']}: v1 zero conversion mismatch")
    require(row["expected_source_access_status"] == "available", f"{row['case_id']}: source access fixture drift")
    require(row["expected_state"] == ("media_missing" if expected_count == 0 else "available"), f"{row['case_id']}: state precedence drift")
    if expected_count:
        first = {key: value for key, value in output[0].items() if key not in {"mediaId", "mediaHash"}}
        require(row["expected_media_v1"] == first, f"{row['case_id']}: v1 must down-convert stable first media")


def validate_once() -> str:
    module = generator_module()
    schema = load(SCHEMA); mapping = load(MAPPING); fixture = load(FIXTURE); manifest = load(MANIFEST)
    validate_schema(schema); validate_mapping(mapping)
    require(fixture["synthetic_only"] is True and fixture["external_calls"] == 0 and fixture["real_media"] == 0 and fixture["writes_to_base"] is False, "fixture safety boundary drift")
    cases = fixture["cases"]
    require([len(row["expected_media_v2"]) for row in cases] == [0, 1, 4], "fixture must cover ordered 0/1/4 media")
    for row, expected in zip(cases, [0, 1, 4], strict=True):
        validate_case(row, expected)
    for path_text, expected in module.FROZEN.items():
        require(fhash(ROOT / path_text) == expected, f"frozen input drift: {path_text}")
    public_manifest = load(ROOT / "data/mvp-contract-v0.4-public-synthetic/manifest.json")
    for path_text, expected in public_manifest["artifact_hashes"].items():
        require(fhash(ROOT / path_text) == expected, f"v0.4 artifact drift: {path_text}")
    public_fixture = load(ROOT / "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json")
    actual_v04_counts = {key: len(public_fixture[key]) for key in module.V04_COUNTS}
    require(actual_v04_counts == module.V04_COUNTS, "v0.4 exact graph count drift")
    require(public_fixture["synthetic_only"] is True and public_fixture["external_calls"] == 0, "v0.4 safety receipt drift")
    expected_artifacts = {path.relative_to(ROOT).as_posix(): fhash(path) for path in [SCHEMA, MAPPING, FIXTURE, GENERATOR, Path(__file__).resolve()]}
    require(manifest["artifact_hashes"] == expected_artifacts, "manifest artifact hash drift")
    require(manifest["frozen_input_hashes"] == module.FROZEN, "manifest frozen hash receipt drift")
    require(manifest["v0_4_frozen_counts"] == module.V04_COUNTS, "manifest v0.4 count receipt drift")
    require(manifest["fixture_counts"] == {"cases": 3, "zero_media": 1, "single_media": 1, "four_media": 1, "media_total": 5}, "manifest fixture counts drift")
    require(manifest["entity_additions"] == manifest["external_calls"] == manifest["real_media"] == 0 and manifest["writes_to_base"] is False, "manifest safety boundary drift")
    expected_values = {SCHEMA: module.schema(), MAPPING: module.mapping(), FIXTURE: module.fixture()}
    require(schema == expected_values[SCHEMA] and mapping == expected_values[MAPPING] and fixture == expected_values[FIXTURE], "generated artifact differs from generator")
    require(manifest["canonical_hashes"] == {path.name: chash(value) for path, value in expected_values.items()}, "canonical hash receipt drift")
    return chash({"schema": schema, "mapping": mapping, "fixture": fixture, "manifest": manifest})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    require(1 <= args.repeat <= 10, "repeat must be 1..10")
    receipts = [validate_once() for _ in range(args.repeat)]
    require(len(set(receipts)) == 1, "independent reload receipt drift")
    print(f"PUBLIC_MULTIMEDIA_SUCCESSOR_VALIDATION_OK repeat={args.repeat} receipt={receipts[0]} external_calls=0")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"PUBLIC_MULTIMEDIA_SUCCESSOR_VALIDATION_FAIL: {exc}")
        raise SystemExit(1)
