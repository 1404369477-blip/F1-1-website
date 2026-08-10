#!/usr/bin/env python3
"""Generate the deterministic local-only public multimedia successor package."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCHEMA = HERE / "schema.json"
MAPPING = HERE / "public-multimedia-mapping.json"
FIXTURE = HERE / "fixtures.multimedia-synthetic.json"
MANIFEST = HERE / "manifest.json"
VALIDATOR = HERE / "validate_successor.py"
FROZEN = {
    "data/mvp-contract-v0.4-public-synthetic/manifest.json": "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
    "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json": "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4",
    "data/mvp-contract-v0.4-public-synthetic/schema.json": "4b2d1abec6c6315c92fd2ae70c6422b894e380850a9b9408d35a385c777ca11f",
    "data/mvp-contract-v0.4-public-synthetic/public-dto-mapping.json": "285bfe529b492c81fe883097615ebae34effbe6a9123a1bfd0184973f3fe7be2",
    "data/mvp-contract-v0/schema.json": "de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4",
}
V04_COUNTS = {
    "sources": 1, "captured_items": 12, "contents": 12, "summaries": 12,
    "media_candidates": 10, "release_bundles": 12, "review_decisions": 12,
    "publications": 12, "published_projections": 12,
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    if path.parent != HERE or path.is_symlink():
        raise RuntimeError(f"unsafe output: {path}")
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=HERE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def schema() -> dict[str, Any]:
    tone = {"type": "string", "enum": ["night", "blue", "amber", "violet", "slate"]}
    media = {
        "type": "object",
        "additionalProperties": False,
        "required": ["kind", "mediaId", "assetRef", "mediaHash", "altZh", "captionZh", "creditDisplay", "tone"],
        "properties": {
            "kind": {"const": "synthetic_placeholder"},
            "mediaId": {"type": "string", "pattern": "^media-[a-z0-9-]+$"},
            "assetRef": {"type": "string", "pattern": "^synthetic:[a-z0-9._:-]+$"},
            "mediaHash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "altZh": {"type": "string", "minLength": 1, "maxLength": 300},
            "captionZh": {"anyOf": [{"type": "string", "maxLength": 300}, {"type": "null"}]},
            "creditDisplay": {"anyOf": [{"type": "string", "maxLength": 120}, {"type": "null"}]},
            "tone": tone,
        },
    }
    item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["publicId", "contentType", "state", "titleZh", "summaryZh", "publishedAt", "sourcePublishedAt", "sourceTimeStatus", "source", "media", "originalLink"],
        "properties": {
            "publicId": {"type": "string", "pattern": "^public-[a-z0-9-]+$"},
            "contentType": {"enum": ["race_news", "driver_social", "legends_history", "paddock_fun"]},
            "state": {"enum": ["available", "restricted", "media_missing"]},
            "titleZh": {"type": "string", "minLength": 1},
            "summaryZh": {"type": "string", "minLength": 1},
            "publishedAt": {"type": "string", "format": "date-time"},
            "sourcePublishedAt": {"anyOf": [{"type": "string", "format": "date-time"}, {"type": "null"}]},
            "sourceTimeStatus": {"enum": ["known", "unknown"]},
            "source": {
                "type": "object", "additionalProperties": False,
                "required": ["sourceId", "platform", "displayName", "byline", "accessStatus"],
                "properties": {
                    "sourceId": {"type": "string"}, "platform": {"enum": ["x", "instagram", "reddit", "website", "rss"]},
                    "displayName": {"type": "string"}, "byline": {"type": "string"}, "accessStatus": {"enum": ["available", "restricted"]},
                },
            },
            "media": {"type": "array", "minItems": 0, "maxItems": 4, "uniqueItems": True, "items": media},
            "originalLink": {
                "type": "object", "additionalProperties": False,
                "required": ["enabled", "url", "reason"],
                "properties": {"enabled": {"const": False}, "url": {"type": "null"}, "reason": {"enum": ["synthetic_only", "source_restricted"]}},
            },
        },
    }
    detail_item = copy.deepcopy(item)
    detail_item["required"].extend(["leadZh", "bodyZh", "keyPointsZh"])
    detail_item["properties"].update({
        "leadZh": {"type": "string", "minLength": 1},
        "bodyZh": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
        "keyPointsZh": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
    })
    page = {
        "type": "object", "additionalProperties": False,
        "required": ["pageSize", "hasMore", "nextCursor"],
        "properties": {
            "pageSize": {"const": 12},
            "hasMore": {"type": "boolean"},
            "nextCursor": {
                "anyOf": [
                    {"type": "null"},
                    {"type": "object", "additionalProperties": False, "required": ["cursorAt", "cursorId"], "properties": {"cursorAt": {"type": "string"}, "cursorId": {"type": "string"}}},
                ]
            },
        },
    }
    canonical_presentation = {
        "type": "object", "additionalProperties": False,
        "required": ["media_candidate_id", "alt_zh", "caption_zh", "credit_display", "tone"],
        "properties": {
            "media_candidate_id": {"type": "string", "pattern": "^media-[a-z0-9-]+$"},
            "alt_zh": {"type": "string", "minLength": 1, "maxLength": 300},
            "caption_zh": {"anyOf": [{"type": "string", "maxLength": 300}, {"type": "null"}]},
            "credit_display": {"anyOf": [{"type": "string", "maxLength": 120}, {"type": "null"}]},
            "tone": tone,
        },
    }
    canonical_media = {
        "type": "object", "additionalProperties": False,
        "required": ["media_candidate_id", "media_hash", "license_status", "safety_status"],
        "properties": {
            "media_candidate_id": {"type": "string", "pattern": "^media-[a-z0-9-]+$"},
            "media_hash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "license_status": {"const": "allowed"},
            "safety_status": {"const": "passed"},
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "urn:f1plus1:public-read:v0.2-multimedia-synthetic",
        "title": "F1+1 public-read-v0.2 multimedia DTO successor",
        "description": "Presentation DTO schema only. It adds no domain entity and does not mutate v0.4.",
        "oneOf": [
            {
                "title": "Feed response", "type": "object", "additionalProperties": False,
                "required": ["schemaVersion", "items", "page"],
                "properties": {
                    "schemaVersion": {"const": "public-read-v0.2"},
                    "items": {"type": "array", "items": {"$ref": "#/$defs/PublicFeedItemV2"}},
                    "page": {"$ref": "#/$defs/PublicPageV1Compatible"},
                },
            },
            {
                "title": "Detail response", "type": "object", "additionalProperties": False,
                "required": ["schemaVersion", "story", "relatedItems"],
                "properties": {
                    "schemaVersion": {"const": "public-read-v0.2"},
                    "story": {"$ref": "#/$defs/PublicStoryDetailV2"},
                    "relatedItems": {"type": "array", "items": {"$ref": "#/$defs/PublicFeedItemV2"}},
                },
            },
        ],
        "$defs": {
            "CanonicalMediaPresentationV2": canonical_presentation,
            "CanonicalMediaSnapshotV2": canonical_media,
            "PublicMediaItemV2": media,
            "PublicFeedItemV2": item,
            "PublicStoryDetailV2": detail_item,
            "PublicPageV1Compatible": page,
        },
    }


def mapping() -> dict[str, Any]:
    return {
        "mapping_version": "public-multimedia-mapping-v0.1",
        "classification": "proposed_public_dto_successor_not_domain_schema",
        "predecessor": {"version": "public-read-v0.1", "immutable": True, "manifest": "data/mvp-contract-v0.4-public-synthetic/manifest.json"},
        "successor": {"version": "public-read-v0.2", "media_cardinality": "0..4", "array_order": "ReleaseBundle.media_refs order", "primary_media": "media[0] when present", "thumbnail_order": "media[1..] without reorder"},
        "non_media_compatibility": "all public-read-v0.1 feed/detail/page/source/originalLink fields and meanings remain byte-shape compatible; detail retains leadZh/bodyZh/keyPointsZh",
        "domain_chain": ["MediaCandidate", "ReleaseBundle", "ReviewDecision", "Publication", "PublishedProjection"],
        "entity_additions": [],
        "input_extension": {
            "owner": "ReleaseBundle.canonical_payload",
            "field": "media_presentations",
            "classification": "immutable_snapshot_member_on_existing_entity",
            "cardinality": "same length and order as ReleaseBundle.media_refs and canonical_payload.media",
            "required_item_fields": ["media_candidate_id", "alt_zh", "caption_zh", "credit_display", "tone"],
            "hash_rule": "included in canonical payload_hash and bundle_hash before approval; any change creates a new immutable Bundle",
        },
        "item_mapping": {
            "media[].mediaId": {"owner": "ReleaseBundle", "pointer": "/media_refs/{index}", "join": "MediaCandidate.media_candidate_id and canonical_payload.media/{index}/media_candidate_id"},
            "media[].assetRef": {"owner": "MediaCandidate", "pointer": "/asset_ref", "guard": "synthetic scheme only; no URL"},
            "media[].mediaHash": {"owner": "MediaCandidate", "pointer": "/media_hash", "join": "canonical_payload.media/{index}/media_hash"},
            "media[].altZh": {"owner": "ReleaseBundle", "pointer": "/canonical_payload/media_presentations/{index}/alt_zh"},
            "media[].captionZh": {"owner": "ReleaseBundle", "pointer": "/canonical_payload/media_presentations/{index}/caption_zh"},
            "media[].creditDisplay": {"owner": "ReleaseBundle", "pointer": "/canonical_payload/media_presentations/{index}/credit_display"},
            "media[].tone": {"owner": "ReleaseBundle", "pointer": "/canonical_payload/media_presentations/{index}/tone"},
        },
        "guards": [
            "0 <= media_refs length <= 4 and all ids unique",
            "media_refs, canonical_payload.media, media_presentations have identical ids, length and order",
            "each MediaCandidate belongs to the same Content and is selected, license allowed, safety passed",
            "candidate media_hash equals canonical media snapshot hash and synthetic asset hash is recomputable",
            "ReleaseBundle approved hash/five fences and Publication/Projection hash chain remain current",
            "any one mismatch rejects the entire story with PUBLIC_READ_INTEGRITY_FAILED; no partial gallery",
        ],
        "state_rule": "restricted wins; otherwise empty media => media_missing; otherwise available",
        "access_rule": "synthetic assets only; assetRef must start synthetic: and contain no URL delimiter; external_calls=0",
        "api_compatibility": {
            "default_without_explicit_v2_accept": "serve unchanged public-read-v0.1",
            "v2_accept": "application/vnd.f1plus1.public-read-v0.2+json",
            "v1_down_conversion": "media=[] => null; media length 1..4 => first item mapped to legacy media object; ordering makes first item stable",
            "v2_response": "schemaVersion public-read-v0.2 and media array 0..4",
            "unsupported_version": {"http": 406, "reasonCode": "PUBLIC_MEDIA_VERSION_UNSUPPORTED"},
            "integrity_failure": {"http": 500, "reasonCode": "PUBLIC_READ_INTEGRITY_FAILED"},
            "rollback": "disable explicit v2 negotiation and continue byte-compatible v1; never rewrite v0.4 fixture or manifest",
        },
        "implementation_handoff": [
            {"file": "app/src/server/public/types.ts", "change": "add PublicMediaItemV2/PublicFeedItemV2 and explicit response version union; keep V1 unchanged"},
            {"file": "app/src/server/public/repository.ts", "change": "validate three ordered lists and full hash/rights/safety chain; emit V2 array or V1 first-item down-conversion"},
            {"file": "app/src/app/api/public/feed/route.ts", "change": "negotiate exact V2 media type; default V1; unsupported version 406"},
            {"file": "app/src/app/api/public/stories/[publicId]/route.ts", "change": "use identical negotiation and mapping for detail/related items"},
            {"file": "app/migrations", "change": "successor migration must store the immutable media_presentations snapshot and include it in payload/bundle hashes; do not alter v0.4 migration"},
        ],
        "external_calls": 0,
        "real_media": 0,
        "writes_to_base": False,
    }


def media(case: str, index: int, tone: str, alt: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    media_id = f"media-mm-{case}-{index + 1}"
    asset_ref = f"synthetic:multimedia-{case}-{index + 1}"
    media_hash = canonical_hash({"asset_ref": asset_ref, "fixture_set": "public-multimedia-synthetic-v0.1", "mime_type": "image/webp"})
    candidate = {
        "media_candidate_id": media_id, "content_id": f"content-mm-{case}", "asset_ref": asset_ref,
        "media_hash": media_hash, "mime_type": "image/webp", "license_status": "allowed",
        "safety_status": "passed", "candidate_status": "selected",
    }
    frozen = {"media_candidate_id": media_id, "media_hash": media_hash, "license_status": "allowed", "safety_status": "passed"}
    presentation = {
        "media_candidate_id": media_id, "alt_zh": alt, "caption_zh": None,
        "credit_display": "F1+1 本地合成占位", "tone": tone,
    }
    return candidate, frozen, presentation


def case(case_id: str, media_specs: list[tuple[str, str]]) -> dict[str, Any]:
    candidates, snapshots, presentations = [], [], []
    for index, (tone, alt) in enumerate(media_specs):
        candidate, frozen, presentation = media(case_id, index, tone, alt)
        candidates.append(candidate); snapshots.append(frozen); presentations.append(presentation)
    refs = [row["media_candidate_id"] for row in candidates]
    content_version_hash = canonical_hash({"content_id": f"content-mm-{case_id}", "fixture_set": "public-multimedia-synthetic-v0.1"})
    summary_version_hash = canonical_hash({"summary_id": f"summary-mm-{case_id}", "fixture_set": "public-multimedia-synthetic-v0.1"})
    payload = {
        "release_bundle_id": f"bundle-mm-{case_id}",
        "content_id": f"content-mm-{case_id}",
        "summary_id": f"summary-mm-{case_id}",
        "content_version_hash": content_version_hash,
        "summary_version_hash": summary_version_hash,
        "rights": {"rights_status": "allowed", "evidence_ref": f"synthetic:rights-mm-{case_id}"},
        "access_snapshot": {"content_access_status": "available"},
        "media": snapshots,
        "media_presentations": presentations,
        "media_snapshot_hash": canonical_hash({"media": snapshots, "media_presentations": presentations}),
    }
    payload_hash = canonical_hash(payload)
    bundle_hash_input = {
        "release_bundle_id": payload["release_bundle_id"], "bundle_version": "v1", "payload_hash": payload_hash,
        "canonical_json_rule_version": "canonical-json-v1", "immutable": True,
    }
    bundle_hash = canonical_hash(bundle_hash_input)
    public_id = f"public-mm-{case_id}"
    published_version_hash = canonical_hash({
        "approved_bundle_hash": bundle_hash, "approved_content_version_hash": content_version_hash,
        "approved_summary_version_hash": summary_version_hash, "public_id": public_id,
        "publish_generation": 1, "release_bundle_id": payload["release_bundle_id"],
    })
    output_media = [
        {
            "kind": "synthetic_placeholder", "mediaId": candidate["media_candidate_id"], "assetRef": candidate["asset_ref"],
            "mediaHash": candidate["media_hash"], "altZh": presentation["alt_zh"], "captionZh": presentation["caption_zh"],
            "creditDisplay": presentation["credit_display"], "tone": presentation["tone"],
        }
        for candidate, presentation in zip(candidates, presentations, strict=True)
    ]
    return {
        "case_id": f"case-{case_id}",
        "media_candidates": candidates,
        "release_bundle": {"release_bundle_id": payload["release_bundle_id"], "bundle_version": "v1", "canonical_json_rule_version": "canonical-json-v1", "media_refs": refs, "canonical_payload": payload, "payload_hash": payload_hash, "bundle_hash_input": bundle_hash_input, "bundle_hash": bundle_hash, "release_status": "approved", "immutable": True},
        "review_decision": {"decision": "approved", "approved_bundle_hash": bundle_hash},
        "publication": {"public_id": public_id, "publish_generation": 1, "publication_status": "published", "approved_bundle_hash": bundle_hash, "approved_content_version_hash": content_version_hash, "approved_summary_version_hash": summary_version_hash, "published_version_hash": published_version_hash},
        "published_projection": {"public_id": public_id, "publish_generation": 1, "projection_status": "published", "published_version_hash": published_version_hash},
        "expected_media_v2": output_media,
        "expected_media_v1": None if not output_media else {key: value for key, value in output_media[0].items() if key not in {"mediaId", "mediaHash"}},
        "expected_state": "media_missing" if not output_media else "available",
        "expected_source_access_status": "available",
    }


def fixture() -> dict[str, Any]:
    return {
        "fixture_version": "public-multimedia-synthetic-v0.1",
        "synthetic_only": True,
        "external_calls": 0,
        "real_media": 0,
        "writes_to_base": False,
        "cases": [
            case("zero", []),
            case("single", [("blue", "本地合成示意图：蓝色赛道节奏与单图卡片。")]),
            case("gallery", [
                ("night", "本地合成四图之一：深色赛道网格。"),
                ("blue", "本地合成四图之二：蓝色维修区线条。"),
                ("amber", "本地合成四图之三：琥珀色计时块。"),
                ("violet", "本地合成四图之四：紫色围场光带。"),
            ]),
        ],
    }


def manifest(values: dict[Path, Any]) -> dict[str, Any]:
    hashes = {path.relative_to(ROOT).as_posix(): file_hash(path) for path in [SCHEMA, MAPPING, FIXTURE, Path(__file__).resolve(), VALIDATOR]}
    return {
        "manifest_version": "public-multimedia-successor-manifest-v0.1",
        "contract_version": "public-read-v0.2",
        "classification": "local_synthetic_dto_successor_not_domain_schema",
        "artifact_hashes": hashes,
        "canonical_hashes": {path.name: canonical_hash(value) for path, value in values.items()},
        "frozen_input_hashes": FROZEN,
        "v0_4_frozen_counts": V04_COUNTS,
        "fixture_counts": {"cases": 3, "zero_media": 1, "single_media": 1, "four_media": 1, "media_total": 5},
        "entity_additions": 0,
        "external_calls": 0,
        "real_media": 0,
        "writes_to_base": False,
    }


def main() -> int:
    for path_text, expected in FROZEN.items():
        actual = file_hash(ROOT / path_text)
        if actual != expected:
            raise RuntimeError(f"frozen input drift: {path_text}: {actual}")
    if not VALIDATOR.is_file() or VALIDATOR.is_symlink():
        raise RuntimeError("regular validator required before generation")
    values = {SCHEMA: schema(), MAPPING: mapping(), FIXTURE: fixture()}
    for path, value in values.items():
        atomic_json(path, value)
    atomic_json(MANIFEST, manifest(values))
    receipt = canonical_hash({path.name: file_hash(path) for path in [SCHEMA, MAPPING, FIXTURE, MANIFEST]})
    print(f"PUBLIC_MULTIMEDIA_SUCCESSOR_GENERATED receipt={receipt} external_calls=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
