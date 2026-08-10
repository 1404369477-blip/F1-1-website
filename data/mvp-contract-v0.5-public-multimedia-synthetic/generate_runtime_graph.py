#!/usr/bin/env python3
"""Generate the complete deterministic 0/1/4 public multimedia runtime graph."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GRAPH_NAME = "runtime-graph.public-multimedia-synthetic.json"
MANIFEST_NAME = "runtime-profile-manifest.json"
GENERATOR_PATH = Path(__file__).resolve()
VALIDATOR_PATH = HERE / "validate_runtime_graph.py"
V05_FIXTURE = HERE / "fixtures.multimedia-synthetic.json"
V05_MANIFEST = HERE / "manifest.json"
V04_FIXTURE = ROOT / "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"
V04_MANIFEST = ROOT / "data/mvp-contract-v0.4-public-synthetic/manifest.json"
PUBLIC_LEDGER = ROOT / "data/mvp-contract-v0.4-public-synthetic/profile-ledger.json"
M3_MANIFEST = ROOT / "data/m4-vs0-seed-enrichment-v0/manifest.json"
PROFILE_ID = "public-multimedia-synthetic"
SQLITE_PATH = "app/.local/f1plus1-public-multimedia-synthetic.sqlite"
CONTRACT_VERSION = "public-read-v0.2"
FIXTURE_SET = "public-multimedia-0-1-4-v0.5"
CANONICAL_RULE = "canonical-json-v1"
FROZEN_V05_ARTIFACTS = {
    "data/mvp-contract-v0.5-public-multimedia-synthetic/schema.json": "ade4feda490a8bc2fd68817d8f48ac0994cdf81dd4703e3317003d04705451de",
    "data/mvp-contract-v0.5-public-multimedia-synthetic/public-multimedia-mapping.json": "3c05b244c0087d9aea35f63f80c38329b0e7205f78a04e7afcb097a1ef04ae7a",
    "data/mvp-contract-v0.5-public-multimedia-synthetic/fixtures.multimedia-synthetic.json": "ee52a70cda9eea32600a443ad5411cd76d2b4cf3d8894d9b46396c28252823c0",
    "data/mvp-contract-v0.5-public-multimedia-synthetic/generate_successor.py": "23f4d8adf0f75f65f56997f9e7ecaa75d70790239fe860373012925cd2d2dc31",
    "data/mvp-contract-v0.5-public-multimedia-synthetic/validate_successor.py": "58063ea96b585fff65b11dedd3b95417a1ded9abc81e08aa102f19bc646e64c7",
}
FROZEN_INPUTS = {
    **FROZEN_V05_ARTIFACTS,
    "data/mvp-contract-v0.5-public-multimedia-synthetic/manifest.json": "a8b607a46e265ded3ddda85c05bcc627d4b9f4d50192b29028704a435affe1ba",
    "data/m4-vs0-seed-enrichment-v0/manifest.json": "473c6f0dd5176ea6a8122577f07c5795c01f3b4c2df737f8f7973968781c5c39",
    "data/mvp-contract-v0.4-public-synthetic/manifest.json": "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
    "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json": "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4",
    "data/mvp-contract-v0.4-public-synthetic/profile-ledger.json": "1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1",
}
ROW_COUNT_KEYS = (
    "sources", "captured_items", "contents", "events", "summaries", "media_candidates",
    "release_bundles", "review_decisions", "publications", "outbox_jobs", "published_projections",
)


class GenerationError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in pairs:
        if key in output:
            raise GenerationError(f"duplicate JSON key: {key}")
        output[key] = value
    return output


def load_json(path: Path) -> Any:
    if not path.is_file() or path.is_symlink():
        raise GenerationError(f"regular non-symlink input required: {path}")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def safe_output_dir(raw: str | None) -> Path:
    target = HERE if raw is None else Path(raw).resolve()
    if not target.is_dir() or target.is_symlink():
        raise GenerationError("output directory must be an existing regular directory")
    allowed_tmp = target == Path("/tmp").resolve() or Path("/tmp").resolve() in target.parents
    if target != HERE and not allowed_tmp:
        raise GenerationError("output directory must be the package directory or a /tmp descendant")
    return target


def atomic_json(path: Path, value: Any) -> None:
    if path.parent.is_symlink() or path.is_symlink():
        raise GenerationError(f"symlink output rejected: {path}")
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def audit(at: str, actor: str = "synthetic:system") -> dict[str, Any]:
    return {"created_at": at, "updated_at": at, "created_by_ref": actor, "updated_by_ref": actor}


def story_definitions() -> list[dict[str, Any]]:
    return [
        {
            "key": "zero", "published_at": "2026-08-09T03:00:00Z", "title": "本地零图完整链样本",
            "summary": "用于验证无媒体卡片仍可通过完整发布链读取。", "lead": "零图样本保持正文可读并明确进入 media_missing。",
            "body": ["该记录只包含本地 synthetic 文本与证据快照。", "ReleaseBundle 的媒体数组为空，公开 DTO 返回空数组。"],
            "points": ["媒体计数为零", "公开状态为 media_missing"],
        },
        {
            "key": "single", "published_at": "2026-08-09T03:01:00Z", "title": "本地单图完整链样本",
            "summary": "用于验证 V2 单元素数组和 V1 稳定首图降级。", "lead": "单图样本只展示主图，不生成无意义导航。",
            "body": ["媒体身份、顺序、hash、rights 与 safety 均来自领域链。", "V1 继续返回同一首图单对象。"],
            "points": ["V2 媒体计数为一", "V1 首图降级稳定"],
        },
        {
            "key": "gallery", "published_at": "2026-08-09T03:02:00Z", "title": "本地四图完整链样本",
            "summary": "用于让缩略图、单步切图和多图 lightbox 获得正式数据出口。", "lead": "四图严格按 ReleaseBundle.media_refs 顺序发布。",
            "body": ["四个 MediaCandidate 具有不同 identity、assetRef 与 mediaHash。", "任何乱序、第五图或 rights/safety 漂移都会整条拒绝。"],
            "points": ["媒体计数为四", "顺序只认 media_refs", "第五图必须拒绝"],
        },
    ]


def build_runtime_graph() -> dict[str, Any]:
    v04 = load_json(V04_FIXTURE)
    v05 = load_json(V05_FIXTURE)
    source = copy.deepcopy(v04["sources"][0])
    frozen_cases = {row["case_id"].removeprefix("case-"): row for row in v05["cases"]}
    captures: list[dict[str, Any]] = []
    contents: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    media_candidates: list[dict[str, Any]] = []
    bundles: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    publications: list[dict[str, Any]] = []
    projections: list[dict[str, Any]] = []
    dto_cases: list[dict[str, Any]] = []

    for story in story_definitions():
        key = story["key"]
        at = story["published_at"]
        fragment = frozen_cases[key]
        capture_id = f"cap-mm-{key}"
        content_id = f"content-mm-{key}"
        summary_id = f"summary-mm-{key}"
        bundle_id = f"bundle-mm-{key}"
        decision_id = f"decision-mm-{key}"
        publication_id = f"publication-mm-{key}"
        public_id = f"public-mm-{key}"
        projection_id = f"projection-mm-{key}"
        internal_url = f"https://synthetic.invalid/public-multimedia/{key}"
        evidence_url = f"https://synthetic.invalid/evidence/public-multimedia/{key}"

        captures.append({
            "capture_id": capture_id, "raw_url": internal_url, "capture_note": "SYNTHETIC_ONLY: public multimedia runtime fixture",
            "captured_at": at, "normalization_status": "valid", "normalization_error": None,
            "dedup_status": "unique", "dedup_match_source_id": None, "source_id": source["source_id"],
            "canonical_url": internal_url, "content_id": content_id, "source_config_epoch": 1, **audit(at),
        })
        content_hash_input = {
            "content_id": content_id, "source_id": source["source_id"], "external_content_id": f"synthetic-public-multimedia-{key}",
            "canonical_url": internal_url, "content_kind": "post", "editorial_category": "race_news",
            "source_time_status": "known", "published_at": at, "content_version": "v1",
            "normalized_title": story["title"], "normalized_body": "\n\n".join(story["body"]), "language": "zh-CN",
            "source_evidence_url": evidence_url, "source_config_epoch": 1,
        }
        content_hash = canonical_hash(content_hash_input)
        contents.append({
            "content_id": content_id, "source_id": source["source_id"], "capture_id": capture_id,
            "external_content_id": content_hash_input["external_content_id"], "external_url": internal_url,
            "canonical_url": internal_url, "content_kind": "post", "editorial_category": "race_news",
            "source_time_status": "known", "content_status": "published", "published_at": at, "captured_at": at,
            "content_version": "v1", "content_version_hash": content_hash, "content_hash_input": content_hash_input,
            "normalized_title": story["title"], "normalized_body": content_hash_input["normalized_body"], "language": "zh-CN",
            "source_evidence_url": evidence_url, "source_config_epoch": 1, **audit(at),
        })
        summary_hash_input = {
            "summary_id": summary_id, "content_id": content_id, "summary_version": "v1", "title_zh": story["title"],
            "summary_zh": story["summary"], "lead_zh": story["lead"], "body_zh": story["body"],
            "key_points_zh": story["points"], "language": "zh-CN", "source_evidence_url": evidence_url,
            "input_content_hash": content_hash, "summary_schema_version": "summary-schema-v2",
            "summarizer": "synthetic:public-multimedia-runtime-v1", "deterministic": True,
        }
        summary_hash = canonical_hash(summary_hash_input)
        summaries.append({
            "summary_id": summary_id, "content_id": content_id, "summary_version": "v1", "summary_version_hash": summary_hash,
            "summary_hash_input": summary_hash_input, "input_content_hash": content_hash,
            "summary_schema_version": "summary-schema-v2", "summarizer": "synthetic:public-multimedia-runtime-v1",
            "deterministic": True, "title_zh": story["title"], "summary_zh": story["summary"], "lead_zh": story["lead"],
            "body_zh": story["body"], "key_points_zh": story["points"], "summary_status": "approved",
            "language": "zh-CN", "source_evidence_url": evidence_url, **audit(at),
        })

        case_media: list[dict[str, Any]] = []
        for frozen_media in fragment["media_candidates"]:
            row = {**copy.deepcopy(frozen_media), **audit(at)}
            if row["content_id"] != content_id:
                raise GenerationError(f"frozen media content mismatch: {key}")
            case_media.append(row)
            media_candidates.append(row)
        refs = [row["media_candidate_id"] for row in case_media]
        snapshots = [{
            "media_candidate_id": row["media_candidate_id"], "media_hash": row["media_hash"],
            "license_status": row["license_status"], "safety_status": row["safety_status"],
        } for row in case_media]
        presentations = copy.deepcopy(fragment["release_bundle"]["canonical_payload"]["media_presentations"])
        legacy = fragment["expected_media_v1"]
        media_presentation = {
            "mode": "none" if legacy is None else legacy["kind"],
            "asset_ref": None if legacy is None else legacy["assetRef"],
            "alt_zh": "本地无图占位：该卡片没有合规媒体。" if legacy is None else legacy["altZh"],
            "caption_zh": None if legacy is None else legacy["captionZh"],
            "credit_display": None if legacy is None else legacy["creditDisplay"],
            "tone": None if legacy is None else legacy["tone"],
        }
        canonical_payload = {
            "release_bundle_id": bundle_id, "content_version_hash": content_hash, "summary_version_hash": summary_hash,
            "content_snapshot": {**content_hash_input, "content_version_hash": content_hash, "capture_id": capture_id, "external_url": internal_url, "captured_at": at},
            "summary_snapshot": {**summary_hash_input, "summary_version_hash": summary_hash},
            "source_snapshot": {
                "source_id": source["source_id"], "canonical_url": source["canonical_url"], "platform": source["platform"],
                "identity_status": source["identity_status"], "source_config_epoch": 1, "source_safety_epoch": 1,
                "display_name": "本地合成多媒体资料", "byline": "F1+1 多媒体验证台",
            },
            "original_url": internal_url, "rights": {"rights_status": "allowed", "evidence_ref": f"synthetic:rights-public-multimedia-{key}"},
            "media": snapshots, "media_presentation": media_presentation, "media_presentations": presentations,
            "policy": {"policy_epoch": 1, "publication_mode": "manual_only", "manual_review_required": True, "safety_rule_version": "safety-rule-v1"},
            "schema": {"domain_schema_version": "mvp-local-v0.4", "payload_schema_version": "release-payload-v2", "canonical_json_rule_version": CANONICAL_RULE},
            "fences": {"source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1},
            "access_snapshot": {"content_access_status": "available", "original_link_status": "disabled_synthetic", "original_link_reason": "synthetic_only"},
            "time_snapshot": {"source_published_at": at, "source_time_status": "known"},
        }
        payload_hash = canonical_hash(canonical_payload)
        bundle_hash_input = {"release_bundle_id": bundle_id, "bundle_version": "v1", "payload_hash": payload_hash, "canonical_json_rule_version": CANONICAL_RULE, "immutable": True}
        bundle_hash = canonical_hash(bundle_hash_input)
        bundles.append({
            "release_bundle_id": bundle_id, "bundle_version": "v1", "content_id": content_id, "summary_id": summary_id,
            "content_version_hash": content_hash, "summary_version_hash": summary_hash, "source_evidence_url": evidence_url,
            "canonical_json_rule_version": CANONICAL_RULE, "canonical_payload": canonical_payload, "payload_hash": payload_hash,
            "bundle_hash_input": bundle_hash_input, "bundle_hash": bundle_hash, "release_status": "approved", "immutable": True,
            "assembled_at": at, "media_refs": refs, "source_config_epoch": 1, "source_safety_epoch": 1,
            "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1, **audit(at),
        })
        decision_hash_input = {
            "review_decision_id": decision_id, "release_bundle_id": bundle_id, "approved_bundle_hash": bundle_hash,
            "review_version": 1, "decision": "approved", "canonical_json_rule_version": CANONICAL_RULE,
            "source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1,
        }
        decisions.append({
            "review_decision_id": decision_id, "content_id": content_id, "summary_id": summary_id, "release_bundle_id": bundle_id,
            "review_version": 1, "decision": "approved", "approved_bundle_hash": bundle_hash,
            "reviewer_ref": "synthetic:reviewer-multimedia", "reviewed_at": at,
            "decision_reason": "SYNTHETIC_ONLY: local multimedia runtime bundle approved",
            "decision_hash_input": decision_hash_input, "decision_hash": canonical_hash(decision_hash_input),
            "canonical_json_rule_version": CANONICAL_RULE, "immutable": True, "source_config_epoch": 1,
            "source_safety_epoch": 1, "authorization_version": 1, "policy_epoch": 1, "recovery_epoch": 1,
            **audit(at, "synthetic:reviewer-multimedia"),
        })
        published_version_hash = canonical_hash({
            "approved_bundle_hash": bundle_hash, "approved_content_version_hash": content_hash,
            "approved_summary_version_hash": summary_hash, "public_id": public_id,
            "publish_generation": 1, "release_bundle_id": bundle_id,
        })
        publications.append({
            "publication_id": publication_id, "content_id": content_id, "summary_id": summary_id, "release_bundle_id": bundle_id,
            "public_id": public_id, "publish_generation": 1, "publication_status": "published", "approved_bundle_hash": bundle_hash,
            "approved_content_version_hash": content_hash, "approved_summary_version_hash": summary_hash,
            "published_version_hash": published_version_hash, "idempotency_key": f"publish:{publication_id}:bundle:{bundle_hash}",
            "reconcile_key": f"reconcile:{publication_id}:{bundle_hash}", "reconcile_status": "not_needed",
            "reconcile_attempt": 0, "last_query_at": None, "emergency_stop": False, "attempt": 1,
            "last_error_code": None, "published_at": at, "source_evidence_url": evidence_url,
            "source_config_epoch": 1, "source_safety_epoch": 1, "authorization_version": 1,
            "policy_epoch": 1, "recovery_epoch": 1, **audit(at),
        })
        projections.append({
            "projection_id": projection_id, "public_id": public_id, "content_id": content_id, "summary_id": summary_id,
            "release_bundle_id": bundle_id, "publish_generation": 1, "projection_status": "published",
            "published_version_hash": published_version_hash, "source_evidence_url": evidence_url,
            "synthetic_only": True, "external_calls": 0, **audit(at),
        })
        media_v2 = copy.deepcopy(fragment["expected_media_v2"])
        base_item = {
            "publicId": public_id, "contentType": "race_news", "state": fragment["expected_state"],
            "titleZh": story["title"], "summaryZh": story["summary"], "publishedAt": at,
            "sourcePublishedAt": at, "sourceTimeStatus": "known",
            "source": {"sourceId": source["source_id"], "platform": source["platform"], "displayName": "本地合成多媒体资料", "byline": "F1+1 多媒体验证台", "accessStatus": "available"},
            "media": media_v2, "originalLink": {"enabled": False, "url": None, "reason": "synthetic_only"},
        }
        v1_item = copy.deepcopy(base_item)
        v1_item["media"] = copy.deepcopy(fragment["expected_media_v1"])
        dto_cases.append({
            "case_id": f"case-{key}", "public_id": public_id, "media_count": len(media_v2),
            "expected_v2_item": base_item, "expected_v1_item": v1_item,
            "expected_detail_extension": {"leadZh": story["lead"], "bodyZh": story["body"], "keyPointsZh": story["points"]},
        })

    arrays = {
        "sources": [source], "captured_items": captures, "contents": contents, "events": [], "summaries": summaries,
        "media_candidates": media_candidates, "release_bundles": bundles, "review_decisions": decisions,
        "publications": publications, "outbox_jobs": [], "published_projections": projections,
    }
    row_counts = {key: len(arrays[key]) for key in ROW_COUNT_KEYS}
    return {
        "runtime_graph_version": "public-multimedia-runtime-graph-v0.1", "profile_id": PROFILE_ID,
        "sqlite_path": SQLITE_PATH, "contract_version": CONTRACT_VERSION, "fixture_set": FIXTURE_SET,
        "canonical_json_rule_version": CANONICAL_RULE, "canonical_json_rule": copy.deepcopy(v04["canonical_json_rule"]),
        "seed_order": list(ROW_COUNT_KEYS), "row_counts": row_counts,
        "synthetic_only": True, "external_calls": 0, "writes_to_base": False,
        "real_content_imported": False, "real_media": 0, **arrays,
        "expected_dto_cases": dto_cases,
        "profile_ledger_seed_contract": {
            "static": {"profile_id": PROFILE_ID, "sqlite_path": SQLITE_PATH, "contract_version": CONTRACT_VERSION, "fixture_set": FIXTURE_SET, "row_counts": row_counts, "synthetic_only": True, "external_calls": 0, "writes_to_base": False, "real_content_imported": False, "real_media": 0},
            "runtime_bindings": {
                "fixture_manifest_hash": "sha256_file(runtime-profile-manifest.json)",
                "fixture_graph_hash": "runtime-profile-manifest.runtime_graph_canonical_sha256",
                "manifest_root_sha256": "runtime-profile-manifest.runtime_manifest_root_sha256",
                "generator_root_sha256": "runtime-profile-manifest.generator_root_sha256",
                "validator_root_sha256": "runtime-profile-manifest.validator_root_sha256",
                "migration_selector_root_sha256": "DEV-MM-01 accepted exact selector root",
                "schema_fingerprint_sha256": "DEV-MM-01 closed SQLite schema fingerprint",
            },
            "row_counts_json_rule": "canonical-json-v1(row_counts)",
            "profile_ledger_root_rule": "accepted ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001 section 4.2; computed inside atomic seed after all runtime bindings are known",
        },
    }


def build_manifest(graph: dict[str, Any], graph_path: Path) -> dict[str, Any]:
    generator_root = file_hash(GENERATOR_PATH)
    validator_root = file_hash(VALIDATOR_PATH)
    graph_file = file_hash(graph_path)
    graph_canonical = canonical_hash(graph)
    new_artifacts = {
        f"data/mvp-contract-v0.5-public-multimedia-synthetic/{GRAPH_NAME}": graph_file,
        "data/mvp-contract-v0.5-public-multimedia-synthetic/generate_runtime_graph.py": generator_root,
        "data/mvp-contract-v0.5-public-multimedia-synthetic/validate_runtime_graph.py": validator_root,
    }
    receipt_input = {
        "scope": "DATA-MM-01-clean-generation-validation-v1", "runtime_graph_file_sha256": graph_file,
        "runtime_graph_canonical_sha256": graph_canonical, "row_counts": graph["row_counts"],
        "generator_root_sha256": generator_root, "validator_root_sha256": validator_root,
        "frozen_input_hashes": FROZEN_INPUTS,
    }
    execution_receipt = canonical_hash(receipt_input)
    manifest_without_root = {
        "runtime_manifest_version": "public-multimedia-runtime-manifest-v0.1", "profile_id": PROFILE_ID,
        "sqlite_path": SQLITE_PATH, "contract_version": CONTRACT_VERSION, "fixture_set": FIXTURE_SET,
        "artifact_hashes": {**FROZEN_V05_ARTIFACTS, **new_artifacts},
        "artifact_hash_scope": "original five ACK artifacts plus runtime graph/generator/validator; excludes this manifest to prevent self-hash recursion",
        "runtime_graph_file_sha256": graph_file, "runtime_graph_canonical_sha256": graph_canonical,
        "row_counts": graph["row_counts"], "generator_root_sha256": generator_root,
        "validator_root_sha256": validator_root, "generator_receipt": execution_receipt,
        "validator_receipt": execution_receipt, "frozen_input_hashes": FROZEN_INPUTS,
        "frozen_roots": {
            "m3_sorted_projection_hash": "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17",
            "v0_4_manifest_sha256": "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
            "v0_4_fixture_sha256": "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4",
            "public_synthetic_ledger_root": "1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1",
            "public_synthetic_graph_root": "4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526",
        },
        "profile_ledger_seed_contract_pointer": f"{GRAPH_NAME}#/profile_ledger_seed_contract",
        "manifest_self_hash_policy": "runtime_manifest_root_sha256 hashes the complete parsed object except this field; this manifest never lists its own file SHA",
        "synthetic_only": True, "external_calls": 0, "writes_to_base": False,
        "real_content_imported": False, "real_media": 0,
    }
    return {**manifest_without_root, "runtime_manifest_root_sha256": canonical_hash(manifest_without_root)}


def verify_frozen() -> None:
    for path_text, expected in FROZEN_INPUTS.items():
        actual = file_hash(ROOT / path_text)
        if actual != expected:
            raise GenerationError(f"frozen input drift: {path_text}: {actual}")
    old_manifest = load_json(V05_MANIFEST)
    if old_manifest["artifact_hashes"] != FROZEN_V05_ARTIFACTS:
        raise GenerationError("v0.5 ACK artifact map drift")
    m3 = load_json(M3_MANIFEST)
    if m3["canonical_projection_hash"] != "e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17":
        raise GenerationError("M3 canonical projection root drift")
    public = load_json(PUBLIC_LEDGER)
    if public["fixture_graph_hash"] != "4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526":
        raise GenerationError("public-synthetic graph root drift")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    output = safe_output_dir(args.output_dir)
    verify_frozen()
    if not VALIDATOR_PATH.is_file() or VALIDATOR_PATH.is_symlink():
        raise GenerationError("regular validator required")
    graph = build_runtime_graph()
    graph_path = output / GRAPH_NAME
    manifest_path = output / MANIFEST_NAME
    atomic_json(graph_path, graph)
    manifest = build_manifest(graph, graph_path)
    atomic_json(manifest_path, manifest)
    print(f"DATA_MM_01_GENERATION_OK receipt={manifest['generator_receipt']} graph={manifest['runtime_graph_canonical_sha256']} external_calls=0")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (GenerationError, OSError, UnicodeError, ValueError, KeyError) as exc:
        print(f"DATA_MM_01_GENERATION_FAIL: {exc}")
        raise SystemExit(1)
