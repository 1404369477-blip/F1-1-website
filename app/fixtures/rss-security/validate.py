#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / "vectors.json").read_text(encoding="utf-8"))
assert data["synthetic_only"] is True
assert data["external_calls"] == 0
assert data["writes_to_base"] is False
vectors = data["vectors"]
assert len({v["id"] for v in vectors}) == len(vectors)
assert set(range(1, 11)).issubset({v["contract"] for v in vectors})
for vector in vectors:
    expected = vector["expected"]
    assert expected["decision"] in {"accept", "reject"}
    if expected["decision"] == "reject":
        assert expected["complete_response_rejected"] is True
        assert expected["cursor_advanced"] is False
        assert expected["data_retained"] is False
        assert (expected["primary_reason_code"] is not None) or vector.get("blocking_conflict")
unresolved = [v["id"] for v in vectors if v["expected"]["primary_reason_code"] is None]
print(json.dumps({"status":"STRUCTURE_OK_WITH_BLOCKERS" if unresolved else "PASS","vectors":len(vectors),"contracts":10,"external_calls":0,"writes_to_base":False,"unresolved_reason_codes":unresolved}, ensure_ascii=False, sort_keys=True))
