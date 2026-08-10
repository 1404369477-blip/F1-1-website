#!/usr/bin/env python3
"""Offline validator for the proposed Admin review implementation mapping."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MAPPING = HERE / "admin-review-mapping.json"
MAPPING_SCHEMA = HERE / "mapping.schema.json"
FIXTURES = HERE / "fixtures.synthetic.json"
MANIFEST = HERE / "manifest.json"
DOMAIN_SCHEMA = ROOT / "data/mvp-contract-v0/schema.json"
STATE_MACHINE = ROOT / "data/mvp-contract-v0/state-machine.json"
INTERNAL_SCHEMA = ROOT / "data/mvp-contract-v0/internal-contract.schema.json"
RUNTIME_ENVELOPE = ROOT / "data/mvp-contract-v0/runtime-envelope.schema.json"
V03_MANIFEST = ROOT / "data/mvp-contract-v0/manifest.json"
PUBLIC_MANIFEST = ROOT / "data/mvp-contract-v0.4-public-synthetic/manifest.json"
PUBLIC_FIXTURE = ROOT / "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json"

EXPECTED_FROZEN_HASHES = {
    "data/mvp-contract-v0/schema.json": "de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4",
    "data/mvp-contract-v0/state-machine.json": "d5ca45fd60c2ad08c60929abd714f6e80c43c20f561be0c0a18e3baa17c7c120",
    "data/mvp-contract-v0/manifest.json": "8a371102c28eaa557d33df8672338cb3aba7b7ae1fe75c0c357c8edaa23b2cde",
    "data/mvp-contract-v0.4-public-synthetic/manifest.json": "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
    "data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json": "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4",
}
EXPECTED_PUBLIC_COUNTS = {
    "sources": 1, "captured_items": 12, "contents": 12, "summaries": 12,
    "media_candidates": 10, "release_bundles": 12, "review_decisions": 12,
    "publications": 12, "published_projections": 12,
}
EXPECTED_SLOT_COUNTS = {
    "ReviewList": 16,
    "ReviewDetailExtension": 6,
    "OperationReceipt": 19,
    "RevisionRequest": 9,
    "RevisionSuccess": 12,
    "ApproveRequest": 6,
    "ApproveSuccess": 10,
    "RejectRequest": 7,
    "RejectSuccess": 8,
    "PublishRequest": 6,
    "PublishSuccess": 12,
}
ALLOWED_ENTITY_OWNERS = {
    "Content", "Summary", "ReleaseBundle", "ReviewDecision", "Publication",
    "OutboxJob", "PublishedProjection", "AuditEvent",
}
ALLOWED_NON_ENTITY_OWNERS = {
    "product_contract", "hash_fence_verifier", "Content+ReviewDecision+Publication",
    "ReviewDecision+Publication", "AuditEvent+OutboxJob", "AuditEvent+OutboxJob+Publication",
    "AuditEvent+Publication+OutboxJob",
}
ARTIFACTS = [MAPPING, MAPPING_SCHEMA, FIXTURES, Path(__file__).resolve()]


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    require(path.is_file() and not path.is_symlink(), f"regular non-symlink file required: {path}")
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"non-finite {value}")),
        )
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot parse {path.relative_to(ROOT)}: {exc}") from exc


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def resolve_schema_pointer(owner: str, pointer: str, domain: dict[str, Any], internal: dict[str, Any]) -> None:
    if owner == "AuditEvent":
        properties = internal["$defs"][owner]["properties"]
    else:
        require(owner in domain["$defs"], f"unknown schema owner: {owner}")
        properties = domain["$defs"][owner]["properties"]
    require(pointer.startswith("/"), f"pointer must start with /: {owner}:{pointer}")
    top = pointer.split("/", 2)[1]
    require(top in properties, f"unresolved pointer: {owner}:{pointer}")


def validate_source_registry(mapping: dict[str, Any], domain: dict[str, Any], internal: dict[str, Any]) -> None:
    registry = mapping["source_registry"]
    used: list[str] = []
    for dto, slots in mapping["dto_slots"].items():
        require(len(slots) == EXPECTED_SLOT_COUNTS[dto], f"{dto} slot count drift")
        for slot, source_id in slots.items():
            require(slot and source_id in registry, f"{dto}.{slot} has no unique source rule")
            used.append(source_id)
    require(sum(EXPECTED_SLOT_COUNTS.values()) == 111, "validator expected slot total drift")
    require(sum(len(value) for value in mapping["dto_slots"].values()) == 111, "mapping slot total must be 111")
    require(set(registry) == set(used), "source_registry must contain exactly the rules used by DTO slots")

    for source_id in sorted(set(used)):
        source = registry[source_id]
        require(set(source) == {"kind", "owner", "json_pointers", "transform"}, f"source rule must be closed: {source_id}")
        require(source["kind"] in {"field", "derived", "constant", "internal_receipt"}, f"invalid source kind: {source_id}")
        require(isinstance(source["json_pointers"], list) and len(source["json_pointers"]) == len(set(source["json_pointers"])), f"pointer list must be unique: {source_id}")
        owner = source["owner"]
        require(owner in ALLOWED_ENTITY_OWNERS | ALLOWED_NON_ENTITY_OWNERS, f"unapproved owner may create second schema: {owner}")
        for raw_pointer in source["json_pointers"]:
            if ":/" in raw_pointer:
                pointer_owner, pointer = raw_pointer.split(":", 1)
                require(pointer_owner in ALLOWED_ENTITY_OWNERS, f"unapproved qualified owner: {pointer_owner}")
                resolve_schema_pointer(pointer_owner, pointer, domain, internal)
            elif owner in ALLOWED_ENTITY_OWNERS:
                resolve_schema_pointer(owner, raw_pointer, domain, internal)
            else:
                require(raw_pointer == "" or ":/" in raw_pointer, f"non-entity pointer must be qualified: {source_id}")


def validate_protocol(mapping: dict[str, Any], fixtures: dict[str, Any], state: dict[str, Any]) -> None:
    protocols = mapping["transaction_protocol"]
    approve = protocols["approve_reservation"]
    enqueue = protocols["manual_publish_enqueue"]
    completion = protocols["manual_publish_completion"]
    require(set(protocols) == {"approve_reservation", "manual_publish_enqueue", "manual_publish_completion"}, "exact three transaction stages required")
    require(set(approve["forbidden_writes"]) >= {"OutboxJob", "TaskEnvelope", "PublishedProjection"}, "approve must forbid dispatch and projection")
    require(any("Publication(queued)" in row for row in approve["writes"]), "approve must reserve queued Publication")
    require(any("OutboxJob" in row for row in enqueue["writes"]), "manual publish must enqueue OutboxJob")
    require(any("TaskEnvelope" in row for row in enqueue["writes"]), "manual publish must create TaskEnvelope")
    require(any("PublishedProjection" in row for row in completion["writes"]), "completion must insert projection")

    publication = state["state_machines"]["publication"]
    states = set(publication["states"])
    require({"queued", "publishing", "published", "retryable_failed", "reconcile_wait", "terminal_failed", "blocked", "emergency_stopped"} == states, "publication states drift")
    transitions = {(row["from"], row["to"]) for row in publication["transitions"]}
    require({("queued", "publishing"), ("publishing", "published"), ("publishing", "reconcile_wait"), ("blocked", "queued")} <= transitions, "required publication transitions missing")

    cases = {row["case_id"]: row for row in fixtures["cases"]}
    require(set(cases) == {
        "case-approve-reserves-publication", "case-manual-publish-enqueues-same-key",
        "case-publish-completion-enables-public-story", "case-publish-unknown-preserves-identity",
        "case-reject-has-no-public-identity",
    }, "fixture case set drift")
    approved = cases["case-approve-reserves-publication"]["after"]
    require((approved["publication_count"], approved["outbox_count"], approved["task_envelope_count"], approved["projection_count"]) == (1, 0, 0, 0), "approve reservation counts invalid")
    require(cases["case-approve-reserves-publication"]["reachable"]["admin_publish_path"].endswith(approved["public_id"] + "/publish"), "reserved publicId must address publish route")
    enqueue_after = cases["case-manual-publish-enqueues-same-key"]["after"]
    require((enqueue_after["publication_count"], enqueue_after["outbox_count"], enqueue_after["task_envelope_count"], enqueue_after["projection_count"]) == (1, 1, 1, 0), "manual publish enqueue counts invalid")
    require(len({enqueue_after["idempotency_key"], enqueue_after["outbox_idempotency_key"], enqueue_after["envelope_idempotency_key"]}) == 1, "idempotency key must match across Publication/Outbox/Envelope")
    require(len({enqueue_after["reconcile_key"], enqueue_after["outbox_reconcile_key"], enqueue_after["envelope_reconcile_key"]}) == 1, "reconcile key must match across Publication/Outbox/Envelope")
    completed = cases["case-publish-completion-enables-public-story"]
    require(completed["before"]["public_story_status"] == 404 and completed["after"]["public_story_status"] == 200, "public story reachability boundary invalid")
    require(completed["after"]["public_id"] == completed["after"]["projection_public_id"], "projection publicId drift")
    unknown = cases["case-publish-unknown-preserves-identity"]
    require(unknown["after"]["publication_count"] == 1 and unknown["after"]["publication_status"] == "reconcile_wait", "unknown must preserve one Publication in reconcile_wait")
    require(unknown["before"]["public_id"] == unknown["after"]["public_id"], "unknown changed public identity")


def validate_frozen_inputs() -> None:
    for path_text, expected in EXPECTED_FROZEN_HASHES.items():
        path = ROOT / path_text
        require(sha256_file(path) == expected, f"frozen hash drift: {path_text}")
    v03_manifest = load_json(V03_MANIFEST)
    for path_text, expected in v03_manifest["artifact_hashes"].items():
        require(sha256_file(ROOT / path_text) == expected, f"v0.3 manifest artifact drift: {path_text}")
    public_manifest = load_json(PUBLIC_MANIFEST)
    for path_text, expected in public_manifest["artifact_hashes"].items():
        require(sha256_file(ROOT / path_text) == expected, f"public manifest artifact drift: {path_text}")
    fixture = load_json(PUBLIC_FIXTURE)
    for key, expected in EXPECTED_PUBLIC_COUNTS.items():
        require(len(fixture[key]) == expected, f"public fixture count drift: {key}")
    require(fixture["external_calls"] == 0 and fixture["synthetic_only"] is True, "public fixture must remain synthetic/no-egress")


def expected_manifest(mapping: dict[str, Any]) -> dict[str, Any]:
    return {
        "manifest_version": "admin-review-mapping-manifest-v0.1",
        "classification": "offline_local_mapping_validator_not_domain_schema",
        "mapping_version": mapping["mapping_version"],
        "mapping_canonical_sha256": hashlib.sha256(canonical_bytes(mapping)).hexdigest(),
        "artifact_hashes": {rel(path): sha256_file(path) for path in ARTIFACTS},
        "frozen_input_hashes": EXPECTED_FROZEN_HASHES,
        "counts": mapping["expected_counts"],
        "public_synthetic_counts": EXPECTED_PUBLIC_COUNTS,
        "external_calls": 0,
        "writes_to_base": False,
        "real_content_imported": False,
    }


def atomic_write_json(path: Path, value: Any) -> None:
    require(path.parent == HERE and not path.is_symlink(), "manifest output root or symlink rejected")
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix=".manifest.", suffix=".tmp", dir=HERE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def validate_once(require_manifest: bool) -> str:
    mapping_schema = load_json(MAPPING_SCHEMA)
    mapping = load_json(MAPPING)
    fixtures = load_json(FIXTURES)
    domain = load_json(DOMAIN_SCHEMA)
    state = load_json(STATE_MACHINE)
    internal = load_json(INTERNAL_SCHEMA)
    load_json(RUNTIME_ENVELOPE)
    require(mapping_schema["$id"] == "urn:f1plus1:admin-review-implementation-mapping:v0.1", "mapping document schema identity drift")
    require(set(mapping) == {"mapping_version", "classification", "contract_refs", "source_registry", "dto_slots", "transaction_protocol", "reachability", "invariants", "expected_counts", "external_calls"}, "mapping root must be closed")
    require(mapping["mapping_version"] == "admin-review-mapping-v0.1", "mapping version drift")
    require(mapping["classification"] == "proposed_implementation_mapping_not_domain_schema", "mapping classification drift")
    require(set(mapping["dto_slots"]) == set(EXPECTED_SLOT_COUNTS), "DTO set drift")
    require(mapping["expected_counts"]["dto_count"] == 11 and mapping["expected_counts"]["dto_slot_count"] == 111, "declared DTO counts drift")
    require(mapping["expected_counts"]["domain_entity_additions"] == 0 and mapping["expected_counts"]["internal_entity_additions"] == 0, "entity additions forbidden")
    require(mapping["external_calls"] == 0 and fixtures["external_calls"] == 0 and fixtures["synthetic_only"] is True, "mapping fixtures must be synthetic/no-egress")
    validate_source_registry(mapping, domain, internal)
    validate_protocol(mapping, fixtures, state)
    validate_frozen_inputs()
    expected = expected_manifest(mapping)
    if require_manifest:
        require(load_json(MANIFEST) == expected, "manifest content/hash drift")
    return hashlib.sha256(canonical_bytes({"mapping": mapping, "fixtures": fixtures, "manifest": expected})).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-manifest", action="store_true", help="atomically refresh only this package manifest")
    parser.add_argument("--repeat", type=int, default=1, help="independent reload validations")
    args = parser.parse_args()
    require(1 <= args.repeat <= 10, "repeat must be between 1 and 10")
    if args.write_manifest:
        mapping = load_json(MAPPING)
        atomic_write_json(MANIFEST, expected_manifest(mapping))
    receipts = [validate_once(require_manifest=True) for _ in range(args.repeat)]
    require(len(set(receipts)) == 1, "independent reload receipts differ")
    print(f"ADMIN_REVIEW_MAPPING_VALIDATION_OK repeat={args.repeat} receipt={receipts[0]} external_calls=0")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"ADMIN_REVIEW_MAPPING_VALIDATION_FAIL: {exc}")
        raise SystemExit(1)
