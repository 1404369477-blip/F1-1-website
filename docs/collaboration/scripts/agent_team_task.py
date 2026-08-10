#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Atomic task queue for agent-team.

Canonical task state lives in one JSON file per task. 收件箱.md is a generated
index and must never be used as the write transaction surface.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

if os.name == "nt":
    import msvcrt
else:
    import fcntl


UTF8_BOOTSTRAP_MARKER = "AGENT_TEAM_TASK_UTF8_BOOTSTRAPPED"


def ensure_utf8_filesystem_runtime() -> None:
    encoding = (sys.getfilesystemencoding() or "").lower().replace("_", "-")
    if encoding not in {"ascii", "us-ascii", "ansi-x3.4-1968"}:
        return
    if os.environ.get(UTF8_BOOTSTRAP_MARKER) == "1":
        raise SystemExit("无法启用 UTF-8 文件系统编码。")
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env[UTF8_BOOTSTRAP_MARKER] = "1"
    os.execve(sys.executable, [sys.executable, *sys.argv], env)


ensure_utf8_filesystem_runtime()

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def reject_duplicate_json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON 含重复键: {key}")
        result[key] = value
    return result


def strict_json_loads(text, source):
    try:
        return json.loads(text, object_pairs_hook=reject_duplicate_json_pairs)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{source} JSON 无效: {exc}") from exc


def discover_control_root() -> Path:
    local = Path(__file__).resolve().parents[1]
    project = local.parents[1]
    inside = subprocess.run(
        ["git", "-C", str(project), "rev-parse", "--is-inside-work-tree"],
        text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    result = subprocess.run(
        ["git", "-C", str(project), "worktree", "list", "--porcelain"],
        text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode == 0:
        first = next((line[9:] for line in result.stdout.splitlines() if line.startswith("worktree ")), "")
        candidate = Path(first) / "docs" / "collaboration" if first else None
        if candidate is not None and candidate.is_dir() and not candidate.is_symlink():
            return candidate.resolve(strict=True)
    if (project / ".git").exists() or (inside.returncode == 0 and inside.stdout.strip() == "true"):
        raise SystemExit("CONTROL_ROOT_ERROR | Git worktree 中无法验证主 docs/collaboration，拒绝写本地副本")
    return local


COLLAB = discover_control_root()
PROJECT = COLLAB.parents[1]
DEPARTMENTS = COLLAB / "部门"
TASKS = COLLAB / "tasks"
LOCKS = COLLAB / ".locks"
SESSION_STATE = COLLAB / "会话启动状态.json"
INDEX_MARKER = "<!-- agent-team task index; use scripts/agent_team_task.py -->"
INDEX_TRANSACTION = LOCKS / "task-index-transaction.json"
SCHEMA_VERSION = 1
PROTOCOL_VERSION = "1.4.10"
STATES = ("queued", "claimed", "blocked", "waiting_input", "completed", "acknowledged")
BUSY_STATES = {"claimed"}
VISIBLE_ACTIVE_STATES = {"claimed", "blocked", "waiting_input"}
STATE_CN = {
    "queued": "待领取",
    "claimed": "进行中",
    "blocked": "阻断",
    "waiting_input": "等待输入",
    "completed": "待统筹核收",
    "acknowledged": "统筹已核收",
}
AUTH_STATES = {"none", "user_required", "user_confirmed", "user_rejected"}
COMPLETION_CLASSES = {"standard", "audit"}
TASK_FIELDS = {
    "schema_version", "task_id", "department", "from_department", "title", "node", "details",
    "acceptance_exit", "failure_paths", "confirmation", "domain_stage", "authorization_state",
    "authorization_evidence", "authorization_history", "execution_state", "completion_class", "pointers",
    "created_at", "updated_at", "revision", "claimed_by", "block_reason", "artifacts", "external_artifacts",
    "verified", "unverified", "mistake_check", "report", "event_receipts",
}
OPTIONAL_TASK_FIELDS = {
    "acknowledged_by", "impact_declaration", "temporary_executor", "temporary_operation_history", "resolution",
}
TRANSITIONS = {
    "claim": {"queued": "claimed"},
    "block": {"claimed": "blocked"},
    "wait": {"claimed": "waiting_input", "blocked": "waiting_input"},
    "resume": {"blocked": "claimed", "waiting_input": "claimed"},
    "complete": {"claimed": "completed"},
    "ack": {"completed": "acknowledged"},
}
TASK_ID_RE = re.compile(r"^TASK-[0-9]{8}-[A-Z0-9]{6}$")
ROLE_DEPARTMENT_NAMES = {
    "lead": "统筹部",
    "do": "执行部",
    "research": "研究部",
    "planning": "策划部",
    "product": "产品部",
    "design": "设计部",
    "dev": "开发部",
    "data": "数据部",
    "auto": "自动化部",
    "content": "内容部",
    "growth": "增长运营部",
    "review": "检验部",
    "test": "测试部",
    "security": "安全部",
    "finance": "财务部",
}
AUDIT_ROLE_IDS = {"review", "test", "security", "finance"}
_TASK_CACHE = None


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="minutes")


def clean(name: str, value: str, *, max_chars: int = 2000) -> str:
    result = value.strip()
    if not result:
        raise ValueError(f"{name} 不能为空")
    if any(ord(ch) < 32 and ch not in "\t" for ch in result):
        raise ValueError(f"{name} 不能包含控制字符")
    if len(result) > max_chars:
        raise ValueError(f"{name} 不能超过 {max_chars} 个字符")
    return result


def ensure_plain_dir(path: Path, root: Path) -> None:
    try:
        root_resolved = root.resolve(strict=True)
        lexical = Path(os.path.abspath(str(path)))
        relative = lexical.relative_to(Path(os.path.abspath(str(root))))
        current = root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError
        resolved = path.resolve(strict=True)
        resolved.relative_to(root_resolved)
    except (OSError, ValueError) as exc:
        raise ValueError(f"不安全目录: {path}") from exc
    if not path.is_dir():
        raise ValueError(f"目录不存在: {path}")


def ensure_plain_file(path: Path, root: Path, *, label: str) -> Path:
    try:
        root_resolved = root.resolve(strict=True)
        lexical = Path(os.path.abspath(str(path)))
        relative = lexical.relative_to(Path(os.path.abspath(str(root))))
        current = root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError
        resolved = path.resolve(strict=True)
        resolved.relative_to(root_resolved)
    except (OSError, ValueError) as exc:
        raise ValueError(f"{label} 路径不安全") from exc
    if not path.is_file():
        raise ValueError(f"{label} 必须是普通文件")
    return lexical


def init_layout() -> None:
    ensure_plain_dir(COLLAB, PROJECT)
    ensure_plain_dir(DEPARTMENTS, COLLAB)
    ensure_plain_dir(TASKS, COLLAB)
    ensure_plain_dir(LOCKS, COLLAB)


@contextmanager
def task_lock():
    lock_path = LOCKS / "tasks.lock"
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(lock_path, flags, 0o600)
    handle = os.fdopen(fd, "a+b", buffering=0)
    try:
        if os.name == "nt":
            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"0")
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def write_atomic(path: Path, data: bytes, mode: int) -> None:
    if path.parent.is_symlink():
        raise ValueError(f"父目录不能是符号链接: {path.parent}")
    temp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp, flags, mode)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("写入失败")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.replace(temp, path)
        fsync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def task_path(task_id: str) -> Path:
    return TASKS / f"{task_id}.json"


def require_task_text(payload: dict, field: str, *, allow_empty: bool = False, max_chars: int = 2000) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(f"任务字段缺失或类型无效: {field}")
    if (value and value != value.strip()) or len(value) > max_chars or any(ord(char) < 32 and char != "\t" for char in value):
        raise ValueError(f"任务文本字段超长或含非法控制字符: {field}")
    return value


def require_task_text_list(
    payload: dict,
    field: str,
    *,
    min_items: int = 0,
    max_items: int | None = None,
    max_chars: int = 2000,
) -> list[str]:
    value = payload.get(field)
    if not isinstance(value, list) or any(
        not isinstance(item, str)
        or not item.strip()
        or item != item.strip()
        or len(item) > max_chars
        or any(ord(char) < 32 and char != "\t" for char in item)
        for item in value
    ):
        raise ValueError(f"任务列表字段无效: {field}")
    if len(value) < min_items or (max_items is not None and len(value) > max_items):
        raise ValueError(f"任务列表字段数量无效: {field}")
    return value


def parse_task_timestamp(payload: dict, field: str) -> dt.datetime:
    value = require_task_text(payload, field, max_chars=64)
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"任务时间戳无效: {field}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"任务时间戳缺失时区: {field}")
    return parsed


def impact_path(raw: str) -> str:
    value = clean("write-path", raw, max_chars=500).replace("\\", "/")
    path = Path(value)
    if path.is_absolute() or value in {".", ".."} or ".." in path.parts:
        raise ValueError("write-path 必须是项目内相对路径")
    forbidden = (".git", ".agent-team", "docs/collaboration")
    if any(value == prefix or value.startswith(prefix + "/") for prefix in forbidden):
        raise ValueError(f"write-path 禁止授权控制根、Git 元数据或临时系统目录: {value}")
    return path.as_posix().rstrip("/")


def validate_impact_declaration(value: object, source: Path, *, task_id: str | None = None) -> dict:
    required = {"write_paths", "shared_contracts", "external_effects", "base_revision", "owner_task", "admission"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError(f"任务影响声明结构无效: {source.name}")
    for field in ("write_paths", "shared_contracts", "external_effects"):
        items = value.get(field)
        if not isinstance(items, list) or any(
            not isinstance(item, str) or not item.strip() or item != item.strip() or len(item) > 500
            or any(ord(char) < 32 for char in item)
            for item in items
        ) or len(items) != len(set(items)):
            raise ValueError(f"任务影响声明列表无效: {field}")
    if not value["write_paths"] or not value["external_effects"]:
        raise ValueError("任务影响声明必须包含 write_paths 和 external_effects")
    normalized_paths = [impact_path(item) for item in value["write_paths"]]
    if normalized_paths != value["write_paths"]:
        raise ValueError("任务影响声明 write_paths 未规范化")
    if "none" in value["external_effects"] and value["external_effects"] != ["none"]:
        raise ValueError("external_effects 中 none 不能与其他副作用并存")
    for field in ("base_revision", "owner_task"):
        field_value = value.get(field)
        if not isinstance(field_value, str) or not field_value.strip() or field_value != field_value.strip():
            raise ValueError(f"任务影响声明 {field} 无效")
    if task_id is not None and value["owner_task"] != task_id:
        raise ValueError(f"任务影响声明 owner_task 与 TASK 不一致: {source.name}")
    if value.get("admission") not in {"safe", "manual", "unsafe", "waiting_base"}:
        raise ValueError(f"任务影响声明 admission 无效: {source.name}")
    return value


def validate_task_payload(payload: object, path: Path) -> dict:
    if not isinstance(payload, dict):
        raise ValueError(f"任务根节点必须是 JSON 对象: {path.name}")
    missing_fields = sorted(TASK_FIELDS - set(payload))
    unknown_fields = sorted(set(payload) - TASK_FIELDS - OPTIONAL_TASK_FIELDS)
    if missing_fields:
        raise ValueError("任务字段缺失: " + ", ".join(missing_fields))
    if unknown_fields:
        raise ValueError("任务含当前 schema 未定义字段: " + ", ".join(unknown_fields))
    impact = payload.get("impact_declaration")
    if impact is not None:
        validate_impact_declaration(impact, path)
    temporary = payload.get("temporary_executor")
    if temporary is not None:
        if not isinstance(temporary, dict) or temporary.get("executor_type") != "temporary":
            raise ValueError(f"temporary_executor 结构无效: {path.name}")
        if temporary.get("parent_department") != payload.get("department"):
            raise ValueError(f"temporary_executor 父部门不匹配: {path.name}")
        nested_impact = temporary.get("impact")
        validate_impact_declaration(nested_impact, path, task_id=payload.get("task_id"))
        if impact is None or nested_impact != impact:
            raise ValueError(f"temporary_executor 的 impact 与 TASK impact_declaration 不一致: {path.name}")
        if temporary.get("promotion_state") not in {
            "not_submitted", "submitted", "reviewing", "waiting_base", "ready", "integrated",
            "archived", "cancelled", "abandoned",
        }:
            raise ValueError(f"temporary_executor 晋升状态无效: {path.name}")
    schema_version = payload.get("schema_version")
    if isinstance(schema_version, bool) or schema_version != SCHEMA_VERSION:
        raise ValueError(f"不支持的任务版本: {path.name}")

    task_id = require_task_text(payload, "task_id")
    if task_id != path.stem or not TASK_ID_RE.fullmatch(task_id):
        raise ValueError(f"任务 ID 与文件名不一致或格式无效: {path.name}")
    if impact is not None:
        validate_impact_declaration(impact, path, task_id=task_id)

    department = require_task_text(payload, "department")
    from_department = require_task_text(payload, "from_department")
    known_departments = set(department_names())
    if department not in known_departments or from_department not in known_departments:
        raise ValueError(f"任务部门不存在: {path.name}")

    for field, max_chars in (
        ("title", 200), ("node", 200), ("details", 2000), ("acceptance_exit", 2000),
        ("confirmation", 2000), ("domain_stage", 200),
    ):
        require_task_text(payload, field, max_chars=max_chars)
    for field, max_chars in (
        ("authorization_evidence", 1000), ("claimed_by", 200), ("block_reason", 2000),
        ("mistake_check", 2000), ("report", 500),
    ):
        require_task_text(payload, field, allow_empty=True, max_chars=max_chars)
    if "acknowledged_by" in payload:
        require_task_text(payload, "acknowledged_by", allow_empty=True)

    require_task_text_list(payload, "failure_paths", min_items=1, max_items=3, max_chars=1000)
    for field, max_chars in (
        ("pointers", 500), ("artifacts", 500), ("external_artifacts", 1000),
        ("verified", 2000), ("unverified", 2000), ("event_receipts", 1000),
    ):
        require_task_text_list(payload, field, max_chars=max_chars)
    for raw in payload["artifacts"]:
        artifact_path = Path(raw)
        if artifact_path.is_absolute() or ".." in artifact_path.parts or raw in {"", "."}:
            raise ValueError(f"任务本地产物路径无效: {path.name}")
    for raw in payload["external_artifacts"]:
        parsed_url = urlparse(raw)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc or parsed_url.username or parsed_url.password:
            raise ValueError(f"任务外部产物 URL 无效: {path.name}")

    authorization = payload["authorization_state"]
    if not isinstance(authorization, str) or authorization not in AUTH_STATES:
        raise ValueError(f"任务授权状态无效: {path.name}")
    if authorization in {"user_confirmed", "user_rejected"} and not payload["authorization_evidence"].strip():
        raise ValueError(f"任务授权证据缺失: {path.name}")
    history = payload.get("authorization_history")
    if not isinstance(history, list):
        raise ValueError(f"任务授权历史无效: {path.name}")
    history_times: list[dt.datetime] = []
    for entry in history:
        if not isinstance(entry, dict) or set(entry) != {"at", "state", "evidence"}:
            raise ValueError(f"任务授权历史条目无效: {path.name}")
        history_times.append(parse_task_timestamp(entry, "at"))
        if not isinstance(entry["state"], str) or entry["state"] not in AUTH_STATES:
            raise ValueError(f"任务授权历史状态无效: {path.name}")
        require_task_text(entry, "evidence", max_chars=1000)
    has_evidence = bool(payload["authorization_evidence"].strip())
    if bool(history) != has_evidence:
        raise ValueError(f"任务当前授权证据与历史有无不一致: {path.name}")
    if history and (history[-1]["state"] != authorization or history[-1]["evidence"] != payload["authorization_evidence"]):
        raise ValueError(f"任务当前授权与历史最新记录不一致: {path.name}")

    state = payload.get("execution_state")
    if not isinstance(state, str) or state not in STATES:
        raise ValueError(f"任务执行状态无效: {path.name}")
    resolution = payload.get("resolution")
    resolution_state = "open" if resolution is None else resolution.get("state") if isinstance(resolution, dict) else None
    if resolution is not None:
        common_fields = {
            "state", "reason", "evidence", "resolved_by", "resolved_at",
            "target_revision_before", "receipt_id",
        }
        superseded_fields = common_fields | {
            "replacement_task_id", "replacement_revision", "replacement_state",
        }
        if not isinstance(resolution, dict) or resolution_state not in {
            "superseded", "rejected_by_user", "abandoned",
        }:
            raise ValueError(f"任务收口轴结构无效: {path.name}")
        expected_fields = superseded_fields if resolution_state == "superseded" else common_fields
        if set(resolution) != expected_fields or payload.get("temporary_executor") is not None:
            raise ValueError(f"任务收口轴字段无效: {path.name}")
        allowed_resolution_states = {"queued", "blocked", "waiting_input"}
        if state not in allowed_resolution_states:
            raise ValueError(f"当前执行状态不允许该收口结论: {path.name}")
        for field in ("reason", "evidence", "resolved_by", "receipt_id"):
            if not isinstance(resolution[field], str):
                raise ValueError(f"任务收口证据类型无效: {path.name}:{field}")
            if not resolution[field].strip() or len(resolution[field]) > 1000:
                raise ValueError(f"任务收口证据缺失: {path.name}:{field}")
        if (
            not resolution["resolved_by"].startswith("统筹部/")
            or any(char.isspace() for char in resolution["resolved_by"])
            or not re.fullmatch(r"RES-[0-9]{8}T[0-9]{6}-[A-F0-9]{8}", resolution["receipt_id"])
            or isinstance(resolution["target_revision_before"], bool)
            or not isinstance(resolution["target_revision_before"], int)
            or resolution["target_revision_before"] < 1
        ):
            raise ValueError(f"任务收口身份或版本无效: {path.name}")
        if resolution_state == "superseded":
            if (
                not TASK_ID_RE.fullmatch(resolution["replacement_task_id"])
                or resolution["replacement_task_id"] == task_id
                or resolution["replacement_state"] == "queued"
                or resolution["replacement_state"] not in STATES
                or isinstance(resolution["replacement_revision"], bool)
                or not isinstance(resolution["replacement_revision"], int)
                or resolution["replacement_revision"] < 1
            ):
                raise ValueError(f"任务替代版本或后续状态无效: {path.name}")
        elif resolution_state == "rejected_by_user" and authorization != "user_rejected":
            raise ValueError(f"用户拒绝收口必须绑定 user_rejected 授权事实: {path.name}")
        parse_task_timestamp(resolution, "resolved_at")
    completion_class = payload.get("completion_class")
    if not isinstance(completion_class, str) or completion_class not in COMPLETION_CLASSES:
        raise ValueError(f"任务完成类型无效: {path.name}")
    expected_completion_class = "audit" if audit_department(department) else "standard"
    if completion_class != expected_completion_class:
        raise ValueError(f"任务完成类型与部门层级不一致: {path.name}")
    revision = payload.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError(f"任务 revision 无效: {path.name}")
    if resolution_state != "open" and resolution["target_revision_before"] + 1 != revision:
        raise ValueError(f"任务收口版本与当前 revision 不连续: {path.name}")
    created_at = parse_task_timestamp(payload, "created_at")
    updated_at = parse_task_timestamp(payload, "updated_at")
    if updated_at < created_at:
        raise ValueError(f"任务 updated_at 早于 created_at: {path.name}")
    if resolution_state != "open":
        resolved_at = parse_task_timestamp(resolution, "resolved_at")
        if resolved_at != updated_at or resolved_at < created_at:
            raise ValueError(f"任务收口时间越出任务时间轴: {path.name}")
    if history_times != sorted(history_times) or any(timestamp < created_at or timestamp > updated_at for timestamp in history_times):
        raise ValueError(f"任务授权历史时间顺序或边界无效: {path.name}")
    if state == "queued" and payload["claimed_by"].strip():
        raise ValueError(f"待领取任务不得预填 claimed_by: {path.name}")
    if state not in {"blocked", "waiting_input"} and payload["block_reason"].strip():
        raise ValueError(f"任务当前状态不得预填 block_reason: {path.name}")
    if state in {"blocked", "waiting_input"} and not payload["block_reason"].strip():
        raise ValueError(f"阻断或等待输入任务缺失 block_reason: {path.name}")
    if state in {"queued", "claimed", "blocked", "waiting_input"} and any((
        payload["artifacts"], payload["external_artifacts"], payload["verified"], payload["unverified"],
        payload["mistake_check"].strip(), payload["report"].strip(), payload["event_receipts"],
    )):
        raise ValueError(f"未完成任务不得预填交付结果: {path.name}")
    if state in {"claimed", "blocked", "waiting_input", "completed", "acknowledged"} and not payload["claimed_by"].strip():
        raise ValueError(f"任务已进入执行生命周期但 claimed_by 缺失: {path.name}")
    if state in {"claimed", "completed", "acknowledged"} and authorization not in {"none", "user_confirmed"}:
        raise ValueError(f"任务当前执行状态与授权状态冲突: {path.name}")
    if state in {"blocked", "waiting_input"} and authorization in {"user_required", "user_rejected"} and not has_evidence:
        raise ValueError(f"阻断或等待输入任务的授权变更缺失证据: {path.name}")
    if state == "acknowledged" and not payload.get("acknowledged_by", "").strip():
        raise ValueError(f"已核收任务缺失 acknowledged_by: {path.name}")
    if state != "acknowledged" and payload.get("acknowledged_by", "").strip():
        raise ValueError(f"未核收任务不得预填 acknowledged_by: {path.name}")
    if state in {"completed", "acknowledged"}:
        if not payload["artifacts"] and not payload["external_artifacts"]:
            raise ValueError(f"已完成任务缺失产物: {path.name}")
        if not payload["verified"] or not payload["unverified"] or not payload["mistake_check"].strip():
            raise ValueError(f"已完成任务缺失验证或自检记录: {path.name}")
        if not payload["report"].strip():
            raise ValueError(f"已完成任务缺失 report 记录: {path.name}")
        if completion_class == "audit" and payload["report"] not in payload["artifacts"]:
            raise ValueError(f"审核任务 report 未同时列入本地产物: {path.name}")
    return payload


def load_task_at(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"任务文件不安全: {path}")
    payload = strict_json_loads(path.read_text(encoding="utf-8"), str(path))
    return validate_task_payload(payload, path)


def locate(task_id: str) -> tuple[str, Path, dict]:
    if not TASK_ID_RE.fullmatch(task_id):
        raise ValueError("任务 ID 格式非法")
    path = task_path(task_id)
    if not path.exists():
        raise ValueError(f"任务不存在: {task_id}")
    task = load_task_at(path)
    return task["execution_state"], path, task


def all_tasks() -> list[tuple[str, Path, dict]]:
    global _TASK_CACHE
    if _TASK_CACHE is not None:
        return _TASK_CACHE
    tasks = [locate(path.stem) for path in sorted(TASKS.glob("TASK-*.json"))]
    by_id = {task["task_id"]: task for _, _, task in tasks}
    for _, path, task in tasks:
        resolution = task.get("resolution")
        if resolution is None or resolution.get("state") != "superseded":
            continue
        replacement = by_id.get(resolution["replacement_task_id"])
        if (
            replacement is None
            or replacement.get("resolution") is not None
            or replacement["revision"] < resolution["replacement_revision"]
            or replacement["execution_state"] == "queued"
        ):
            raise ValueError(f"任务替代证据已缺失、倒退或再次收口: {path.name}")
    _TASK_CACHE = tasks
    return tasks


def invalidate_task_cache() -> None:
    global _TASK_CACHE
    _TASK_CACHE = None


def configured_departments() -> dict[str, str]:
    if SESSION_STATE.is_symlink() or not SESSION_STATE.is_file():
        raise ValueError("会话启动状态缺失或不安全")
    payload = strict_json_loads(SESSION_STATE.read_text(encoding="utf-8"), str(SESSION_STATE))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1 or payload.get("protocol_version") != PROTOCOL_VERSION:
        raise ValueError("会话启动状态版本无效")
    departments = payload.get("departments")
    if not isinstance(departments, dict) or not departments:
        raise ValueError("会话启动状态未登记部门")
    result: dict[str, str] = {}
    for name, item in departments.items():
        if not isinstance(name, str) or not isinstance(item, dict):
            raise ValueError("会话启动状态部门条目无效")
        role_id = item.get("role_id")
        if not isinstance(role_id, str) or ROLE_DEPARTMENT_NAMES.get(role_id) != name:
            raise ValueError(f"会话启动状态的部门与固定角色不一致: {name}")
        if not isinstance(item.get("active"), bool):
            raise ValueError(f"会话启动状态 active 无效: {name}")
        department_path = DEPARTMENTS / name
        ensure_plain_dir(department_path, DEPARTMENTS)
        result[name] = role_id
    return result


def department_names() -> list[str]:
    return sorted(configured_departments())


def require_department(name: str) -> None:
    if name not in department_names():
        raise ValueError(f"未知部门: {name}")
    payload = strict_json_loads(SESSION_STATE.read_text(encoding="utf-8"), str(SESSION_STATE))
    if not payload["departments"][name]["active"]:
        raise ValueError(f"部门已停用，不能承接新动作: {name}")


def audit_department(name: str) -> bool:
    role_id = configured_departments().get(name)
    if role_id is None:
        raise ValueError(f"未登记部门: {name}")
    return role_id in AUDIT_ROLE_IDS


def local_artifact(raw: str) -> str:
    value = clean("artifact", raw, max_chars=500)
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT / candidate
    project_lexical = Path(os.path.abspath(str(PROJECT)))
    candidate_lexical = Path(os.path.abspath(str(candidate)))
    try:
        relative = candidate_lexical.relative_to(project_lexical)
        current = PROJECT
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(PROJECT.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise ValueError(f"本地产物不存在、越界或经过符号链接: {value}") from exc
    if not (resolved.is_file() or resolved.is_dir()):
        raise ValueError(f"本地产物类型不受支持: {value}")
    if resolved == PROJECT.resolve(strict=True):
        raise ValueError("项目根目录不能作为任务产物")
    return resolved.relative_to(PROJECT.resolve(strict=True)).as_posix()


def external_artifact(raw: str) -> str:
    value = clean("external-artifact", raw, max_chars=1000)
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("external-artifact 必须是无内嵌凭据的 http/https URL")
    return value


def audit_report(raw: str, department: str, task_id: str) -> str:
    if not raw.strip() or raw.strip() == "不适用":
        raise ValueError("审核任务必须提交本部门审核报告")
    relative = local_artifact(raw)
    expected = f"docs/collaboration/部门/{department}/报告/"
    if not relative.startswith(expected) or not relative.endswith(".md"):
        raise ValueError(f"审核报告必须是本部门 报告/ 下的 Markdown 文件: {expected}")
    text = (PROJECT / relative).read_text(encoding="utf-8-sig")
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise ValueError("审核报告缺少 YAML frontmatter")
    header = text.split("\n---\n", 1)[0][4:]
    fields = {}
    for line_number, line in enumerate(header.splitlines(), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line != line.lstrip() or ":" not in line:
            raise ValueError(f"审核报告 YAML 只允许顶层单行字段: line {line_number}")
        key, value = line.split(":", 1)
        normalized_key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", normalized_key):
            raise ValueError(f"审核报告 YAML 字段名无效: line {line_number}")
        if normalized_key in fields:
            raise ValueError(f"审核报告 YAML 含重复字段: {normalized_key}")
        scalar = value.strip()
        if scalar.startswith('"') or scalar.endswith('"'):
            if not (scalar.startswith('"') and scalar.endswith('"')):
                raise ValueError(f"审核报告 YAML 引号无效: {normalized_key}")
            try:
                scalar = json.loads(scalar)
            except json.JSONDecodeError as exc:
                raise ValueError(f"审核报告 YAML 字符串无效: {normalized_key}") from exc
        elif scalar.startswith("'") or scalar.endswith("'"):
            if not (scalar.startswith("'") and scalar.endswith("'")):
                raise ValueError(f"审核报告 YAML 引号无效: {normalized_key}")
            scalar = scalar[1:-1].replace("''", "'")
        if not isinstance(scalar, str):
            raise ValueError(f"审核报告 YAML 字段必须是字符串: {normalized_key}")
        fields[normalized_key] = scalar.strip()
    required = {"type", "department", "target", "status", "date", "related_task", "decision", "tags", "summary"}
    missing = sorted(key for key in required if not fields.get(key))
    if missing:
        raise ValueError("审核报告 YAML 缺少字段: " + ", ".join(missing))
    if fields["type"] != "audit_report" or fields["department"] != department or fields["related_task"] != task_id:
        raise ValueError("审核报告 YAML 的 type / department / related_task 与任务不一致")
    if fields["status"] != "final":
        raise ValueError("审核报告 status 必须为 final；pending 草稿不能完成审核任务")
    if fields["decision"] not in {"pass", "fail"}:
        raise ValueError("审核报告 decision 必须为 pass 或 fail")
    placeholders = {"待定", "待补", "待填", "待填写", "pending", "todo", "tbd", "n/a", "-"}
    normalized_summary = fields["summary"].strip().lower()
    if normalized_summary in placeholders or normalized_summary.startswith(("待填", "待补", "todo", "tbd")):
        raise ValueError("审核报告 summary 仍是占位内容")
    return relative


def registered_lead_actor() -> str:
    if SESSION_STATE.is_symlink() or not SESSION_STATE.is_file():
        raise ValueError("会话状态缺失或不安全，不能执行统筹动作")
    payload = strict_json_loads(SESSION_STATE.read_text(encoding="utf-8"), str(SESSION_STATE))
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("protocol_version") != PROTOCOL_VERSION
        or not isinstance(payload.get("departments"), dict)
    ):
        raise ValueError("会话启动状态根真值无效")
    item = payload["departments"].get("统筹部", {})
    thread_id = item.get("thread_id", "")
    if (
        item.get("role_id") != "lead"
        or item.get("step") != "registered"
        or not isinstance(thread_id, str)
        or not thread_id
        or len(thread_id) > 300
        or thread_id.startswith("=")
        or any(char.isspace() for char in thread_id)
    ):
        raise ValueError("统筹部会话尚未登记，不能执行统筹动作")
    return f"统筹部/{thread_id}"


def render_inboxes(*, force: bool = False) -> None:
    tasks = all_tasks()
    departments = department_names()
    for department in departments:
        inbox = DEPARTMENTS / department / "收件箱.md"
        if inbox.exists():
            ensure_plain_file(inbox, COLLAB, label=f"{department} 收件箱")
            existing = inbox.read_text(encoding="utf-8-sig")
            if INDEX_MARKER not in existing and not force:
                raise ValueError(f"收件箱尚未迁移为事务索引: {department}")
        queued = [
            (s, p, t) for s, p, t in tasks
            if t["department"] == department and s == "queued"
            and t.get("resolution") is None
            and t["authorization_state"] in {"none", "user_confirmed"}
        ]
        gated = [
            (s, p, t) for s, p, t in tasks
            if t["department"] == department and s == "queued"
            and t.get("resolution") is None
            and t["authorization_state"] in {"user_required", "user_rejected"}
        ]
        active = [
            (s, p, t) for s, p, t in tasks
            if t["department"] == department and s in VISIBLE_ACTIVE_STATES and t.get("resolution") is None
        ]
        review = [
            (s, p, t) for s, p, t in tasks
            if department == "统筹部" and s == "completed" and t.get("resolution") is None
        ]
        lines = [
            f"# {department} · 收件箱",
            "",
            INDEX_MARKER,
            "> 自动索引；任务正文与状态以 `../../tasks/` 中的单任务 JSON 为准，不要手工编辑。",
            "",
            "## 待领取",
            "",
        ]
        if queued:
            for state, path, task in queued:
                lines.append(f"- [`{task['task_id']}`](../../tasks/{path.name}) · {task['title']}")
        else:
            lines.append("_(没有待领取任务)_")
        lines.extend(["", "## 待授权 / 已拒绝", ""])
        if gated:
            for state, path, task in gated:
                label = "待用户确认" if task["authorization_state"] == "user_required" else "用户已拒绝"
                lines.append(f"- [`{task['task_id']}`](../../tasks/{path.name}) · {label} · {task['title']}")
        else:
            lines.append("_(没有授权闸任务)_")
        lines.extend(["", "## 当前在办 / 阻断", ""])
        if active:
            for state, path, task in active:
                lines.append(f"- [`{task['task_id']}`](../../tasks/{path.name}) · {STATE_CN[state]} · {task['title']}")
        else:
            lines.append("_(没有在办任务)_")
        if department == "统筹部":
            lines.extend(["", "## 待核收回报", ""])
            if review:
                for state, path, task in review:
                    lines.append(f"- [`{task['task_id']}`](../../tasks/{path.name}) · 来自:{task['department']} · {task['title']}")
            else:
                lines.append("_(没有待核收回报)_")
        write_atomic(inbox, ("\n".join(lines).rstrip() + "\n").encode("utf-8"), 0o644)


def refresh_inboxes() -> None:
    try:
        render_inboxes()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"TASK_INDEX_STALE | {exc} | 任务 JSON 已落盘；修复收件箱后运行 rebuild-index", file=sys.stderr)


def recover_index_transaction() -> bool:
    if not INDEX_TRANSACTION.exists():
        return False
    if INDEX_TRANSACTION.is_symlink() or not INDEX_TRANSACTION.is_file():
        raise ValueError("任务索引事务标记不安全")
    payload = strict_json_loads(INDEX_TRANSACTION.read_text(encoding="utf-8"), str(INDEX_TRANSACTION))
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schema_version", "kind", "operation_id", "task_id"}
        or payload.get("schema_version") != 1
        or payload.get("kind") != "task-index-refresh"
        or not isinstance(payload.get("operation_id"), str)
        or not re.fullmatch(r"IDX-[0-9]{8}T[0-9]{6}-[A-F0-9]{8}", payload["operation_id"])
        or not isinstance(payload.get("task_id"), str)
        or not TASK_ID_RE.fullmatch(payload["task_id"])
    ):
        raise ValueError("任务索引事务标记无效")
    # marker 不携带任何可写路径；恢复只从 TASK 真值重建索引。
    render_inboxes(force=True)
    INDEX_TRANSACTION.unlink()
    fsync_dir(LOCKS)
    print(f"TASK_INDEX_RECOVERY_OK | {payload['operation_id']} | task_id={payload['task_id']}")
    return True


def save_new(task: dict) -> Path:
    path = task_path(task["task_id"])
    if path.exists():
        raise ValueError(f"任务已存在: {task['task_id']}")
    validate_task_payload(task, path)
    data = json.dumps(task, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    write_atomic(path, data, 0o600)
    invalidate_task_cache()
    return path


def transition(task_id: str, action: str, mutate) -> tuple[dict, Path]:
    state, source, task = locate(task_id)
    allowed = TRANSITIONS[action]
    if state not in allowed:
        raise ValueError(f"非法状态转换: {state} --{action}--> ?")
    if task.get("resolution") is not None:
        raise ValueError("已收口任务不得再进入执行状态机")
    target_state = allowed[state]
    task = dict(task)
    mutate(task)
    task["execution_state"] = target_state
    task["updated_at"] = now_iso()
    task["revision"] = int(task.get("revision", 0)) + 1
    validate_task_payload(task, source)
    data = json.dumps(task, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    write_atomic(source, data, 0o600)
    invalidate_task_cache()
    return task, source


def update_task(
    task_id: str, mutate, *, allowed_states: set[str], timestamp: str | None = None,
) -> tuple[dict, Path]:
    state, path, task = locate(task_id)
    if state not in allowed_states:
        raise ValueError(f"当前状态不允许更新任务记录: {state}")
    if task.get("resolution") is not None:
        raise ValueError("已收口任务不得再更新")
    task = dict(task)
    mutate(task)
    task["updated_at"] = timestamp or now_iso()
    task["revision"] = int(task.get("revision", 0)) + 1
    validate_task_payload(task, path)
    data = json.dumps(task, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    write_atomic(path, data, 0o600)
    invalidate_task_cache()
    return task, path


def busy_for(department: str, *, excluding: str | None = None) -> list[str]:
    result = []
    for state, _, task in all_tasks():
        if (state in BUSY_STATES and task["department"] == department and task["task_id"] != excluding
                and not task.get("temporary_executor")):
            result.append(task["task_id"])
    return result


def paths_overlap(left: str, right: str) -> bool:
    return left == right or left.startswith(right + "/") or right.startswith(left + "/")


def active_temporary_impacts(task_id: str) -> list[tuple[str, dict]]:
    active: list[tuple[str, dict]] = []
    for _, path, other in all_tasks():
        if other["task_id"] == task_id:
            continue
        temporary = other.get("temporary_executor")
        if not isinstance(temporary, dict) or temporary.get("promotion_state") in {"archived", "abandoned", "cancelled"}:
            continue
        declared = other.get("impact_declaration")
        nested = temporary.get("impact")
        validate_impact_declaration(declared, path, task_id=other["task_id"])
        validate_impact_declaration(nested, path, task_id=other["task_id"])
        if declared != nested:
            raise ValueError(f"临时外包 {other['task_id']} 的影响声明真值冲突")
        active.append((other["task_id"], declared))
    return active


def require_formal_temporary_compatibility(task: dict, path: Path) -> None:
    temporary_impacts = active_temporary_impacts(task["task_id"])
    if not temporary_impacts:
        return
    impact = task.get("impact_declaration")
    if impact is None:
        raise ValueError(
            "存在未收口临时外包，正式任务 claim 前必须先用 declare-impact 明确声明影响范围"
        )
    validate_impact_declaration(impact, path, task_id=task["task_id"])
    if impact["external_effects"] != ["none"]:
        raise ValueError("正式任务存在外部副作用，无法自动证明与临时外包并行安全")
    for other_task_id, other in temporary_impacts:
        if other["external_effects"] != ["none"]:
            raise ValueError(f"临时外包 {other_task_id} 存在外部副作用，拒绝并行 claim")
        if any(paths_overlap(left, right) for left in impact["write_paths"] for right in other["write_paths"]):
            raise ValueError(f"正式任务写路径与临时外包冲突: {other_task_id}")
        shared = sorted(set(impact["shared_contracts"]) & set(other["shared_contracts"]))
        if shared:
            raise ValueError(f"正式任务共享契约与临时外包冲突: {other_task_id}: {', '.join(shared)}")


def cmd_declare_impact(args) -> int:
    state, path, current = locate(args.task_id)
    if current.get("resolution") is not None:
        raise ValueError("已收口任务不得再声明影响")
    if current.get("temporary_executor"):
        raise ValueError("临时外包影响声明只能通过 agent_team_temporary.py 修改")
    if state != "queued":
        raise ValueError("正式任务只能在 queued 状态声明 impact")
    if current["revision"] != args.expected_revision:
        raise ValueError("expected-revision 与 TASK 当前 revision 不一致")
    write_paths = [impact_path(item) for item in args.write_path]
    if len(write_paths) != len(set(write_paths)):
        raise ValueError("write-path 不能重复")
    shared_contracts = [clean("shared-contract", item, max_chars=500) for item in args.shared_contract]
    if len(shared_contracts) != len(set(shared_contracts)):
        raise ValueError("shared-contract 不能重复")
    external_effects = [clean("external-effect", item, max_chars=500) for item in (args.external_effect or ["none"])]
    if len(external_effects) != len(set(external_effects)):
        raise ValueError("external-effect 不能重复")
    if "none" in external_effects and external_effects != ["none"]:
        raise ValueError("external-effect=none 不能与其他副作用并存")
    declaration = {
        "write_paths": write_paths,
        "shared_contracts": shared_contracts,
        "external_effects": external_effects,
        "base_revision": clean("base-revision", args.base_revision, max_chars=300),
        "owner_task": current["task_id"],
        "admission": "manual",
    }
    validate_impact_declaration(declaration, path, task_id=current["task_id"])
    candidate = dict(current)
    candidate["impact_declaration"] = declaration
    active_temporaries = active_temporary_impacts(current["task_id"])
    require_formal_temporary_compatibility(candidate, path)
    if active_temporaries:
        declaration["admission"] = "safe"

    def mutate(item: dict) -> None:
        item["impact_declaration"] = declaration

    task, updated_path = update_task(args.task_id, mutate, allowed_states={"queued"})
    print(f"TASK_IMPACT_OK | {task['task_id']} | revision:{task['revision']} | {updated_path.relative_to(PROJECT)}")
    return 0


def cmd_enqueue(args) -> int:
    require_department(args.department)
    require_department(args.from_department)
    actor = clean("actor", args.actor, max_chars=200)
    expected_actor = registered_lead_actor()
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor};该字段只作审计声明")
    failure_paths = [clean("failure-path", item, max_chars=1000) for item in args.failure_path]
    if not 1 <= len(failure_paths) <= 3:
        raise ValueError("failure-path 必须提供 1-3 项")
    if args.authorization_state not in AUTH_STATES:
        raise ValueError("authorization-state 非法")
    authorization_evidence = args.authorization_evidence.strip()
    if args.authorization_state in {"user_confirmed", "user_rejected"} and not authorization_evidence:
        raise ValueError("已确认或已拒绝的授权记录必须提供 authorization-evidence")
    task_id = f"TASK-{dt.datetime.now():%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"
    timestamp = now_iso()
    task = {
        "schema_version": SCHEMA_VERSION,
        "task_id": task_id,
        "department": args.department,
        "from_department": args.from_department,
        "title": clean("title", args.title, max_chars=200),
        "node": clean("node", args.node, max_chars=200),
        "details": clean("details", args.details),
        "acceptance_exit": clean("acceptance-exit", args.acceptance_exit),
        "failure_paths": failure_paths,
        "confirmation": clean("confirmation", args.confirmation),
        "domain_stage": clean("domain-stage", args.domain_stage, max_chars=200),
        "authorization_state": args.authorization_state,
        "authorization_evidence": clean("authorization-evidence", authorization_evidence, max_chars=1000) if authorization_evidence else "",
        "authorization_history": ([{
            "at": timestamp,
            "state": args.authorization_state,
            "evidence": clean("authorization-evidence", authorization_evidence, max_chars=1000),
        }] if authorization_evidence else []),
        "execution_state": "queued",
        "completion_class": "audit" if audit_department(args.department) else "standard",
        "pointers": [clean("pointer", item, max_chars=500) for item in args.pointer],
        "created_at": timestamp,
        "updated_at": timestamp,
        "revision": 1,
        "claimed_by": "",
        "block_reason": "",
        "artifacts": [],
        "external_artifacts": [],
        "verified": [],
        "unverified": [],
        "mistake_check": "",
        "report": "",
        "event_receipts": [],
        "resolution": None,
    }
    path = save_new(task)
    refresh_inboxes()
    print(f"TASK_ENQUEUED | {task_id} | {path.relative_to(PROJECT)}")
    return 0


def cmd_claim(args) -> int:
    _, current_path, current = locate(args.task_id)
    if current.get("resolution") is not None:
        raise ValueError("已收口任务不得再领取")
    if current.get("temporary_executor"):
        raise ValueError("临时外包生命周期只能通过 agent_team_temporary.py 修改")
    require_department(current["department"])
    authorization = current["authorization_state"]
    if authorization in {"user_required", "user_rejected"}:
        raise ValueError(f"当前授权状态禁止领取: {authorization}")
    if authorization == "user_confirmed" and not current.get("authorization_evidence"):
        raise ValueError("用户确认缺少授权证据记录")
    other = busy_for(current["department"], excluding=args.task_id)
    if other:
        raise ValueError("本部门已有在办任务: " + ", ".join(other))
    require_formal_temporary_compatibility(current, current_path)
    task, path = transition(args.task_id, "claim", lambda item: item.update(claimed_by=clean("claimed-by", args.claimed_by, max_chars=200)))
    refresh_inboxes()
    print(f"TASK_CLAIMED | {task['task_id']} | {path.relative_to(PROJECT)}")
    return 0


def cmd_block(args) -> int:
    _, _, current = locate(args.task_id)
    if current.get("temporary_executor"):
        raise ValueError("临时外包生命周期只能通过 agent_team_temporary.py 修改")
    task, path = transition(args.task_id, "block", lambda item: item.update(block_reason=clean("reason", args.reason)))
    refresh_inboxes()
    print(f"TASK_BLOCKED | {task['task_id']} | {path.relative_to(PROJECT)}")
    return 0


def cmd_wait(args) -> int:
    _, _, current = locate(args.task_id)
    if current.get("temporary_executor"):
        raise ValueError("临时外包生命周期只能通过 agent_team_temporary.py 修改")
    task, path = transition(args.task_id, "wait", lambda item: item.update(block_reason=clean("reason", args.reason)))
    refresh_inboxes()
    print(f"TASK_WAITING_INPUT | {task['task_id']} | {path.relative_to(PROJECT)}")
    return 0


def cmd_resume(args) -> int:
    _, current_path, current = locate(args.task_id)
    if current.get("temporary_executor"):
        raise ValueError("临时外包生命周期只能通过 agent_team_temporary.py 修改")
    require_department(current["department"])
    authorization = current["authorization_state"]
    if authorization in {"user_required", "user_rejected"}:
        raise ValueError(f"当前授权状态禁止恢复: {authorization}")
    other = busy_for(current["department"], excluding=args.task_id)
    if other:
        raise ValueError("本部门已有其他在办任务: " + ", ".join(other))
    require_formal_temporary_compatibility(current, current_path)
    task, path = transition(args.task_id, "resume", lambda item: item.update(block_reason=""))
    refresh_inboxes()
    print(f"TASK_RESUMED | {task['task_id']} | {path.relative_to(PROJECT)}")
    return 0


def cmd_authorize(args) -> int:
    actor = clean("actor", args.actor, max_chars=200)
    expected_actor = registered_lead_actor()
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor};该字段只作审计声明")
    _, _, current = locate(args.task_id)
    if current.get("resolution") is not None:
        raise ValueError("已收口任务不得再修改授权")
    if current.get("temporary_executor"):
        raise ValueError("临时外包生命周期只能通过 agent_team_temporary.py 修改")
    evidence = clean("evidence", args.evidence, max_chars=1000)
    state = args.state
    if state not in {"user_required", "user_confirmed", "user_rejected"}:
        raise ValueError("授权状态非法")

    def mutate(item: dict) -> None:
        item["authorization_state"] = state
        item["authorization_evidence"] = evidence
        history = list(item.get("authorization_history", []))
        history.append({"at": now_iso(), "state": state, "evidence": evidence})
        item["authorization_history"] = history

    task, path = update_task(
        args.task_id,
        mutate,
        allowed_states={"queued", "blocked", "waiting_input"},
    )
    refresh_inboxes()
    print(f"TASK_AUTH_RECORDED | {task['task_id']} | {state} | {path.relative_to(PROJECT)}")
    return 0


def cmd_supersede(args) -> int:
    state, path, current = locate(args.task_id)
    if state not in {"queued", "blocked", "waiting_input"} or current.get("resolution") is not None:
        raise ValueError("只允许收口 open queued / blocked / waiting_input 任务；claimed 任务须先 block")
    if current.get("temporary_executor") is not None:
        raise ValueError("临时外包任务必须按专用生命周期收口")
    if current["revision"] != args.expected_revision:
        raise ValueError("expected-revision 与 TASK 当前 revision 不一致")
    actor = clean("actor", args.actor, max_chars=200)
    expected_actor = registered_lead_actor()
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor}")
    replacement_state, _, replacement = locate(args.replacement_task)
    if replacement["task_id"] == current["task_id"]:
        raise ValueError("replacement-task 不能指向原任务自身")
    if replacement.get("resolution") is not None:
        raise ValueError("replacement-task 已收口，不能作为有效替代事实")
    if replacement["revision"] != args.expected_replacement_revision:
        raise ValueError("expected-replacement-revision 与替代 TASK 当前 revision 不一致")
    source_created = parse_task_timestamp(current, "created_at")
    replacement_updated = parse_task_timestamp(replacement, "updated_at")
    later_fact = replacement_updated >= source_created and replacement_state != "queued"
    if not later_fact:
        raise ValueError(
            "replacement-task 未形成可审计后续事实：必须不早于原任务，且已进入执行生命周期"
        )
    reason = clean("reason", args.reason, max_chars=1000)
    evidence = clean("evidence", args.evidence, max_chars=1000)
    timestamp = now_iso()
    candidate = dict(current)
    receipt_id = "RES-" + dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8].upper()
    candidate["resolution"] = {
        "state": "superseded",
        "replacement_task_id": replacement["task_id"],
        "reason": reason,
        "evidence": evidence,
        "resolved_by": actor,
        "resolved_at": timestamp,
        "target_revision_before": current["revision"],
        "replacement_revision": replacement["revision"],
        "replacement_state": replacement_state,
        "receipt_id": receipt_id,
    }
    candidate["updated_at"] = timestamp
    candidate["revision"] = current["revision"] + 1
    validate_task_payload(candidate, path)
    original_task = path.read_bytes()
    inboxes = {
        ensure_plain_file(inbox, COLLAB, label="收件箱"): inbox.read_bytes()
        for inbox in (DEPARTMENTS / name / "收件箱.md" for name in department_names())
    }
    index_operation = "IDX-" + dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8].upper()
    index_marker = {
        "schema_version": 1, "kind": "task-index-refresh",
        "operation_id": index_operation, "task_id": candidate["task_id"],
    }
    try:
        write_atomic(
            INDEX_TRANSACTION,
            json.dumps(index_marker, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n",
            0o600,
        )
        encoded = json.dumps(candidate, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
        write_atomic(path, encoded, 0o600)
        invalidate_task_cache()
        render_inboxes()
        INDEX_TRANSACTION.unlink()
        fsync_dir(LOCKS)
    except Exception:
        write_atomic(path, original_task, 0o600)
        invalidate_task_cache()
        for inbox, data in inboxes.items():
            write_atomic(inbox, data, 0o644)
        if INDEX_TRANSACTION.exists() and not INDEX_TRANSACTION.is_symlink() and INDEX_TRANSACTION.is_file():
            INDEX_TRANSACTION.unlink()
            fsync_dir(LOCKS)
        raise
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    print(
        f"TASK_RESOLUTION_OK | state=superseded | task_id={candidate['task_id']} | "
        f"replacement={replacement['task_id']} | revision={candidate['revision']} | "
        f"receipt_id={receipt_id} | digest={digest} | path={path.relative_to(PROJECT)}"
    )
    return 0


def cmd_resolve(args) -> int:
    state, _, current = locate(args.task_id)
    if state not in {"queued", "blocked", "waiting_input"} or current.get("resolution") is not None:
        raise ValueError("只允许收口 open queued / blocked / waiting_input 任务；claimed 任务须先 block")
    if current.get("temporary_executor") is not None:
        raise ValueError("临时外包任务必须按专用生命周期收口")
    if current["revision"] != args.expected_revision:
        raise ValueError("expected-revision 与 TASK 当前 revision 不一致")
    actor = clean("actor", args.actor, max_chars=200)
    expected_actor = registered_lead_actor()
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor};该字段只作审计声明")
    resolution_state = args.state
    timestamp = now_iso()
    receipt_id = "RES-" + dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8].upper()
    resolution = {
        "state": resolution_state,
        "reason": clean("reason", args.reason, max_chars=1000),
        "evidence": clean("evidence", args.evidence, max_chars=1000),
        "resolved_by": actor,
        "resolved_at": timestamp,
        "target_revision_before": current["revision"],
        "receipt_id": receipt_id,
    }

    def mutate(item: dict) -> None:
        if resolution_state == "rejected_by_user" and item["authorization_state"] != "user_rejected":
            item["authorization_state"] = "user_rejected"
            item["authorization_evidence"] = resolution["evidence"]
            history = list(item.get("authorization_history", []))
            history.append({
                "at": timestamp, "state": "user_rejected", "evidence": resolution["evidence"],
            })
            item["authorization_history"] = history
        item["resolution"] = resolution

    task, path = update_task(
        args.task_id, mutate, allowed_states={"queued", "blocked", "waiting_input"}, timestamp=timestamp,
    )
    refresh_inboxes()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    print(
        f"TASK_RESOLUTION_OK | state={resolution_state} | task_id={task['task_id']} | "
        f"revision={task['revision']} | receipt_id={receipt_id} | digest={digest} | "
        f"path={path.relative_to(PROJECT)}"
    )
    return 0


def cmd_complete(args) -> int:
    _, _, current = locate(args.task_id)
    if current.get("temporary_executor"):
        raise ValueError("临时外包必须通过 agent_team_temporary.py 固定候选并 submit")
    authorization = current["authorization_state"]
    if authorization in {"user_required", "user_rejected"}:
        raise ValueError(f"当前授权状态禁止完成: {authorization}")
    local_paths = [local_artifact(value) for value in args.artifact]
    external_urls = [external_artifact(value) for value in args.external_artifact]
    if not local_paths and not external_urls:
        raise ValueError("complete 必须提供至少一个已验证的本地产物或显式外部产物")
    report_path = clean("report", args.report, max_chars=500)
    if current.get("completion_class") == "audit" or audit_department(current["department"]):
        report_path = audit_report(args.report, current["department"], current["task_id"])
        if report_path not in local_paths:
            raise ValueError("审核报告必须同时通过 --artifact 提交")

    def mutate(item: dict) -> None:
        item["artifacts"] = local_paths
        item["external_artifacts"] = external_urls
        item["verified"] = [clean("verified", value) for value in args.verified]
        item["unverified"] = [clean("unverified", value) for value in args.unverified]
        item["mistake_check"] = clean("mistake-check", args.mistake_check)
        item["report"] = report_path
        item["event_receipts"] = [clean("event-receipt", value, max_chars=1000) for value in args.event_receipt]
        item["block_reason"] = ""
    if not args.verified or not args.unverified:
        raise ValueError("complete 必须提供 verified 和 unverified；无未验证项时传入“无”")
    task, path = transition(args.task_id, "complete", mutate)
    refresh_inboxes()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    print(
        f"TASK_STATE_OK | state_persisted | local_paths_checked={len(local_paths)} | "
        f"external_declared={len(external_urls)} | {task['updated_at']} | "
        f"{task['task_id']} | {digest} | {path.relative_to(PROJECT)}"
    )
    return 0


def cmd_ack(args) -> int:
    _, _, current = locate(args.task_id)
    if current.get("temporary_executor"):
        raise ValueError("临时外包必须通过 agent_team_temporary.py acknowledge")
    actor = clean("acknowledged-by", args.acknowledged_by, max_chars=200)
    expected = registered_lead_actor()
    if actor != expected:
        raise ValueError(f"acknowledged-by 必须匹配当前已登记统筹会话: {expected};该字段仍只作审计声明")
    task, path = transition(args.task_id, "ack", lambda item: item.update(acknowledged_by=actor))
    refresh_inboxes()
    print(f"TASK_ACK | {task['updated_at']} | {task['task_id']} | {path.relative_to(PROJECT)}")
    return 0


def cmd_list(args) -> int:
    rows = []
    for state, path, task in all_tasks():
        if args.department and task["department"] != args.department:
            continue
        if args.state and state != args.state:
            continue
        resolution_labels = {
            "superseded": "已取代", "rejected_by_user": "用户拒绝后收口", "abandoned": "已放弃",
        }
        if task.get("resolution"):
            label = resolution_labels.get(task["resolution"].get("state"), STATE_CN[state])
        elif state == "queued" and task["authorization_state"] == "user_required":
            label = "待用户确认"
        elif state == "queued" and task["authorization_state"] == "user_rejected":
            label = "用户已拒绝，待收口"
        else:
            label = STATE_CN[state]
        rows.append(f"{task['task_id']} | {label} | {task['department']} | {task['title']} | {path.relative_to(PROJECT)}")
    print("\n".join(rows) if rows else "NO_TASKS")
    return 0


def cmd_rebuild_index(args) -> int:
    render_inboxes(force=True)
    print("TASK_INDEX_OK")
    return 0


def cmd_doctor(args) -> int:
    tasks = all_tasks()
    print(f"TASK_DOCTOR_OK | tasks={len(tasks)} | full_history_validated=true")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="agent-team 原子任务队列")
    sub = root.add_subparsers(dest="cmd", required=True)
    enqueue = sub.add_parser("enqueue")
    enqueue.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    enqueue.add_argument("--department", required=True)
    enqueue.add_argument("--from-department", required=True)
    enqueue.add_argument("--title", required=True)
    enqueue.add_argument("--node", required=True)
    enqueue.add_argument("--details", required=True)
    enqueue.add_argument("--acceptance-exit", required=True)
    enqueue.add_argument("--failure-path", action="append", required=True)
    enqueue.add_argument("--confirmation", default="无需额外确认")
    enqueue.add_argument("--domain-stage", default="通用执行")
    enqueue.add_argument("--authorization-state", choices=sorted(AUTH_STATES), default="none")
    enqueue.add_argument("--authorization-evidence", default="")
    enqueue.add_argument("--pointer", action="append", default=[])
    enqueue.set_defaults(func=cmd_enqueue)
    declare = sub.add_parser("declare-impact")
    declare.add_argument("--task-id", required=True)
    declare.add_argument("--expected-revision", required=True, type=int)
    declare.add_argument("--write-path", action="append", required=True)
    declare.add_argument("--shared-contract", action="append", default=[])
    declare.add_argument("--external-effect", action="append", default=[])
    declare.add_argument("--base-revision", required=True)
    declare.set_defaults(func=cmd_declare_impact)
    claim = sub.add_parser("claim")
    claim.add_argument("--task-id", required=True)
    claim.add_argument("--claimed-by", required=True)
    claim.set_defaults(func=cmd_claim)
    for name, func in (("block", cmd_block), ("wait", cmd_wait)):
        command = sub.add_parser(name)
        command.add_argument("--task-id", required=True)
        command.add_argument("--reason", required=True)
        command.set_defaults(func=func)
    resume = sub.add_parser("resume")
    resume.add_argument("--task-id", required=True)
    resume.set_defaults(func=cmd_resume)
    authorize = sub.add_parser("authorize")
    authorize.add_argument("--task-id", required=True)
    authorize.add_argument("--state", choices=("user_required", "user_confirmed", "user_rejected"), required=True)
    authorize.add_argument("--evidence", required=True)
    authorize.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    authorize.set_defaults(func=cmd_authorize)
    supersede = sub.add_parser("supersede")
    supersede.add_argument("--task-id", required=True)
    supersede.add_argument("--replacement-task", required=True)
    supersede.add_argument("--expected-revision", required=True, type=int)
    supersede.add_argument("--expected-replacement-revision", required=True, type=int)
    supersede.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    supersede.add_argument("--reason", required=True)
    supersede.add_argument("--evidence", required=True)
    supersede.set_defaults(func=cmd_supersede)
    resolve = sub.add_parser("resolve")
    resolve.add_argument("--task-id", required=True)
    resolve.add_argument("--state", choices=("rejected_by_user", "abandoned"), required=True)
    resolve.add_argument("--expected-revision", required=True, type=int)
    resolve.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    resolve.add_argument("--reason", required=True)
    resolve.add_argument("--evidence", required=True)
    resolve.set_defaults(func=cmd_resolve)
    complete = sub.add_parser("complete")
    complete.add_argument("--task-id", required=True)
    complete.add_argument("--artifact", action="append", default=[])
    complete.add_argument("--external-artifact", action="append", default=[])
    complete.add_argument("--verified", action="append", required=True)
    complete.add_argument("--unverified", action="append", required=True)
    complete.add_argument("--mistake-check", required=True)
    complete.add_argument("--report", default="不适用")
    complete.add_argument("--event-receipt", action="append", default=[])
    complete.set_defaults(func=cmd_complete)
    ack = sub.add_parser("ack")
    ack.add_argument("--task-id", required=True)
    ack.add_argument(
        "--acknowledged-by", required=True,
        help="当前已登记统筹会话，格式：统筹部/会话ID",
    )
    ack.set_defaults(func=cmd_ack)
    listing = sub.add_parser("list")
    listing.add_argument("--department")
    listing.add_argument("--state", choices=STATES)
    listing.set_defaults(func=cmd_list)
    rebuild = sub.add_parser("rebuild-index")
    rebuild.set_defaults(func=cmd_rebuild_index)
    doctor = sub.add_parser("doctor")
    doctor.set_defaults(func=cmd_doctor)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        init_layout()
        with task_lock():
            recover_index_transaction()
            return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"TASK_ERROR | {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
