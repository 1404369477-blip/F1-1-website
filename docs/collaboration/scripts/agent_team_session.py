#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Durable resume state for external thread creation and same-department switches."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import stat
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl


UTF8_BOOTSTRAP_MARKER = "AGENT_TEAM_SESSION_UTF8_BOOTSTRAPPED"
PROTOCOL_VERSION = "1.4.10"
ROOT_FIELDS = {
    "schema_version", "protocol_version", "created_at", "updated_at", "profile",
    "session_mode", "role_order", "departments",
}
ITEM_FIELDS = {
    "role_id", "active", "notification_mode", "step", "thread_id", "previous_thread_id",
    "failed_from", "evidence", "operation_id", "note", "updated_at", "lifecycle_history",
}


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


def archive_receipt_fields(evidence: str) -> dict[str, set[str]]:
    fields: dict[str, set[str]] = {}
    for token in evidence.split():
        key, separator, value = token.partition("=")
        if separator and key and value and not value.startswith("="):
            fields.setdefault(key.casefold(), set()).add(value)
    return fields


def valid_archive_receipt(evidence: str, thread_id: str) -> bool:
    fields = archive_receipt_fields(evidence)
    return (
        fields.get("thread_id") == {thread_id}
        and {value.casefold() for value in fields.get("archived", set())} == {"true"}
        and bool(fields.get("host") or fields.get("user_confirmation"))
    )


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
STATE_FILE = COLLAB / "会话启动状态.json"
REGISTRY_FILE = COLLAB / "部门表.md"
LOCKS = COLLAB / ".locks"
TASKS = COLLAB / "tasks"
STEPS = {"pending", "created", "onboarded", "registered", "failed"}
ALLOWED = {
    "pending": {"created", "failed"},
    "created": {"onboarded", "failed"},
    "onboarded": {"registered", "failed"},
    "registered": set(),
}


def now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="minutes")


def clean(name: str, value: str, max_chars: int = 500) -> str:
    result = value.strip()
    if not result:
        raise ValueError(f"{name} 不能为空")
    if any(ord(ch) < 32 for ch in result):
        raise ValueError(f"{name} 含控制字符")
    if len(result) > max_chars:
        raise ValueError(f"{name} 过长")
    return result


def clean_thread_id(value: str) -> str:
    result = clean("thread-id", value, max_chars=300)
    if any(char.isspace() for char in result):
        raise ValueError("thread-id 不能包含空格、换行或制表符")
    if result.startswith("="):
        raise ValueError("thread-id 不能以等号开头")
    return result


@contextmanager
def state_lock():
    if LOCKS.exists() and (LOCKS.is_symlink() or not LOCKS.is_dir()):
        raise ValueError("锁目录不安全")
    LOCKS.mkdir(mode=0o700, exist_ok=True)
    lock_info = LOCKS.stat()
    if not stat.S_ISDIR(lock_info.st_mode) or (hasattr(os, "getuid") and lock_info.st_uid != os.getuid()):
        raise ValueError("锁目录不安全或不属于当前用户")
    if hasattr(os, "chmod"):
        os.chmod(LOCKS, 0o700)
    path = LOCKS / "identity.lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    file_info = os.fstat(fd)
    if not stat.S_ISREG(file_info.st_mode) or file_info.st_nlink != 1:
        os.close(fd)
        raise ValueError("身份锁不是单链接普通文件")
    if hasattr(os, "getuid") and file_info.st_uid != os.getuid():
        os.close(fd)
        raise ValueError("身份锁不属于当前用户")
    if hasattr(os, "fchmod"):
        os.fchmod(fd, 0o600)
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


def load() -> dict:
    if STATE_FILE.is_symlink() or not STATE_FILE.is_file():
        raise ValueError("会话启动状态文件缺失或不安全")
    payload = strict_json_loads(STATE_FILE.read_text(encoding="utf-8"), str(STATE_FILE))
    if (
        not isinstance(payload, dict)
        or set(payload) != ROOT_FIELDS
        or payload.get("schema_version") != 1
        or payload.get("protocol_version") != PROTOCOL_VERSION
        or any(not isinstance(payload.get(field), str) or not payload.get(field) for field in ("created_at", "updated_at", "profile"))
        or payload.get("session_mode") not in {"auto", "manual"}
        or not isinstance(payload.get("role_order"), list)
        or not isinstance(payload.get("departments"), dict)
        or not payload["departments"]
    ):
        raise ValueError("会话启动状态版本无效")
    for department, item in payload["departments"].items():
        if not isinstance(department, str) or not isinstance(item, dict) or set(item) != ITEM_FIELDS:
            raise ValueError(f"会话启动状态部门条目无效: {department}")
        if (
            not isinstance(item.get("active"), bool)
            or item.get("notification_mode") not in {"auto", "manual"}
            or item.get("step") not in STEPS
        ):
            raise ValueError(f"会话启动状态部门值无效: {department}")
        if any(not isinstance(item[field], str) for field in ITEM_FIELDS - {"active", "lifecycle_history"}):
            raise ValueError(f"会话启动状态部门类型无效: {department}")
        history = item["lifecycle_history"]
        if not isinstance(history, list) or any(
            not isinstance(event, dict)
            or set(event) != {"event", "at", "actor", "evidence", "thread_id"}
            or event.get("event") not in {"retired", "deactivated", "reactivated"}
            or any(not isinstance(event.get(field), str) or not event.get(field) for field in ("at", "actor", "evidence"))
            or not isinstance(event.get("thread_id"), str)
            for event in history
        ):
            raise ValueError(f"会话启动状态 lifecycle_history 无效: {department}")
    role_ids = [item["role_id"] for item in payload["departments"].values()]
    if (
        any(not isinstance(role, str) for role in payload["role_order"])
        or len(payload["role_order"]) != len(set(payload["role_order"]))
        or set(payload["role_order"]) != set(role_ids)
    ):
        raise ValueError("会话启动状态 role_order 无效")
    audit_roles = {"review", "test", "security", "finance"}
    active_layers = set()
    for item in payload["departments"].values():
        if not item["active"]:
            continue
        role_id = item["role_id"]
        active_layers.add("management" if role_id == "lead" else "audit" if role_id in audit_roles else "execution")
    if active_layers != {"management", "execution", "audit"}:
        raise ValueError("活跃部门未保持管理、执行、审核三层最小结构")
    validate_identity_registry(payload)
    return payload


def validate_identity_registry(payload: dict) -> None:
    departments = payload.get("departments")
    if not isinstance(departments, dict) or not departments:
        raise ValueError("会话启动状态未登记部门")
    owners: dict[str, str] = {}

    def register(raw: object, owner: str) -> None:
        if not isinstance(raw, str):
            raise ValueError(f"thread_id 类型无效: {owner}")
        if not raw:
            return
        if len(raw) > 300 or raw.startswith("=") or any(char.isspace() for char in raw):
            raise ValueError(f"thread_id 不可表示为归档回执: {owner}")
        previous = owners.get(raw)
        if previous is not None:
            raise ValueError(f"thread_id 全局冲突: {raw}: {previous} / {owner}")
        owners[raw] = owner

    for department, item in departments.items():
        if not isinstance(department, str) or not isinstance(item, dict) or item.get("step") not in STEPS:
            raise ValueError(f"会话启动状态部门条目无效: {department}")
        current_thread = item.get("thread_id", "")
        previous_thread = item.get("previous_thread_id", "")
        operation_id = item.get("operation_id", "")
        failed_from = item.get("failed_from", "")
        if not item.get("active", False) and (
            item.get("step") != "pending" or current_thread or previous_thread
        ):
            raise ValueError(f"已停用部门仍保留活动会话事实: {department}")
        for label, thread_id in (("thread_id", current_thread), ("previous_thread_id", previous_thread)):
            if isinstance(thread_id, str) and thread_id and (
                len(thread_id) > 300
                or thread_id.startswith("=")
                or any(char.isspace() for char in thread_id)
            ):
                raise ValueError(f"会话 {label} 不可表示为归档回执: {department}")
        if not isinstance(operation_id, str) or not operation_id:
            raise ValueError(f"会话 operation_id 无效: {department}")
        if previous_thread and not operation_id.startswith("SWITCH-"):
            raise ValueError(f"待收口旧会话缺少 SWITCH 事务: {department}")
        if operation_id.startswith("SWITCH-") and not previous_thread:
            raise ValueError(f"SWITCH 事务缺少 previous_thread_id: {department}")
        if item["step"] == "pending" and current_thread:
            raise ValueError(f"pending 会话不得预先占用 thread_id: {department}")
        if item["step"] in {"created", "onboarded", "registered"} and not current_thread:
            raise ValueError(f"{item['step']} 会话缺少 thread_id: {department}")
        if item["step"] == "failed":
            if failed_from not in {"pending", "created", "onboarded"}:
                raise ValueError(f"failed 会话缺少可恢复的 failed_from: {department}")
            if (failed_from == "pending") == bool(current_thread):
                raise ValueError(f"failed 会话的 thread_id 与 failed_from 矛盾: {department}")
        elif failed_from:
            raise ValueError(f"非 failed 会话不得保留 failed_from: {department}")
        register(current_thread, f"正式部门:{department}:current")
        register(previous_thread, f"正式部门:{department}:previous")

    if TASKS.is_symlink():
        raise ValueError("tasks 目录不能是符号链接")
    if not TASKS.exists():
        return
    if not TASKS.is_dir():
        raise ValueError("tasks 路径不是普通目录")
    for path in sorted(TASKS.glob("TASK-*.json")):
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"TASK 路径不安全: {path.name}")
        task = strict_json_loads(path.read_text(encoding="utf-8"), str(path))
        if not isinstance(task, dict):
            raise ValueError(f"TASK 根节点无效: {path.name}")
        temporary = task.get("temporary_executor")
        if not isinstance(temporary, dict):
            continue
        session = temporary.get("temporary_session")
        if not isinstance(session, dict):
            raise ValueError(f"临时会话登记结构无效: {path.name}")
        register(session.get("thread_id", ""), f"临时外包:{task.get('task_id', path.stem)}")


def write_atomic(path: Path, data: bytes, mode: int) -> None:
    temp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
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
    finally:
        temp.unlink(missing_ok=True)


def refresh_registry(payload: dict) -> None:
    if REGISTRY_FILE.is_symlink() or not REGISTRY_FILE.is_file():
        raise ValueError("部门表缺失或不安全")
    lines = REGISTRY_FILE.read_text(encoding="utf-8").splitlines()
    seen = set()
    for index, line in enumerate(lines):
        if not line.startswith("|") or "---" in line or "角色 ID" in line:
            continue
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(parts) < 6:
            continue
        department = parts[1]
        item = payload["departments"].get(department)
        if item is None:
            continue
        parts[3] = item.get("thread_id") or "待登记"
        parts[4] = item.get("notification_mode") or "待登记"
        parts[5] = "已停用" if not item.get("active", False) else {
            "pending": "待启用", "created": "上岗中", "onboarded": "上岗中",
            "registered": "已启用", "failed": "失败",
        }.get(item.get("step"), "待启用")
        lines[index] = "| " + " | ".join(parts) + " |"
        seen.add(department)
    if seen != set(payload["departments"]):
        raise ValueError("部门表与会话状态中的部门不一致")
    write_atomic(REGISTRY_FILE, ("\n".join(lines).rstrip() + "\n").encode("utf-8"), 0o644)


def save(payload: dict) -> None:
    validate_identity_registry(payload)
    data = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    write_atomic(STATE_FILE, data, 0o600)
    try:
        refresh_registry(payload)
    except (OSError, ValueError) as exc:
        print(f"SESSION_INDEX_STALE | {exc} | 会话状态 JSON 已落盘", file=sys.stderr)


def entry(payload: dict, department: str) -> dict:
    try:
        item = payload["departments"][department]
        if not item.get("active", False):
            raise ValueError(f"部门已停用: {department}")
        return item
    except KeyError as exc:
        raise ValueError(f"未知部门: {department}") from exc


def registered_lead_actor(payload: dict) -> str:
    item = payload["departments"].get("统筹部", {})
    thread_id = item.get("thread_id", "")
    if (
        item.get("role_id") != "lead"
        or not item.get("active", False)
        or item.get("step") != "registered"
        or not isinstance(thread_id, str)
        or not thread_id
    ):
        raise ValueError("统筹部会话尚未登记")
    return f"统筹部/{thread_id}"


def cmd_rebuild_registry(args) -> int:
    payload = load()
    rows = []
    audit_roles = {"review", "test", "security", "finance"}
    by_role = {item["role_id"]: (department, item) for department, item in payload["departments"].items()}
    for role_id in payload["role_order"]:
        department, item = by_role[role_id]
        layer = "管理层" if role_id == "lead" else "审核层" if role_id in audit_roles else "执行层"
        status = "已停用" if not item["active"] else {
            "pending": "待启用", "created": "上岗中", "onboarded": "上岗中",
            "registered": "已启用", "failed": "失败",
        }[item["step"]]
        rows.append(
            f"| {layer} | {department} | `{role_id}` | {item['thread_id'] or '待登记'} | "
            f"{item['notification_mode']} | {status} |"
        )
    content = """# 部门表

> 把岗位绑定到具体会话;没有真实会话工具收据时,会话 ID 保持待登记。

## 团队摘要

- 项目类型:{profile}
- 创建日期:{created_at}
- 协议版本:{protocol}
- 会话创建模式:{session_mode}

## 部门列表

| 层 | 部门 | 角色 ID | 会话 ID | 通知模式 | 状态 |
|----|------|---------|---------|----------|------|
{rows}

## 使用规则

- 管理层、执行层、审核层必须齐全;新增、删除或替换部门前先获用户确认。
- `manual` 只生成文件;`auto` 也必须以真实会话工具收据和状态登记为准,不得把配置写成已创建。
- 每个新会话首次读本部门上岗引导、岗位说明、交接班文档和收件箱;同一会话后续不重复读上岗引导。
- 任务正文和状态只认 `tasks/TASK-*.json`;收件箱是活动任务索引,通知只发任务 ID 和短状态。
- 产品体验、范围取舍、设计方向、发布/外发、明显成本和隐私安全风险由用户确认;设计预览仅在用户提出或任务明确要求时制作。
- 审核部门亲自验证并只回结论和证据,不直接返工、放行或修改产物。
- 同部门换班须由用户授权;新会话登记成功后才归档旧会话,不 fork 旧历史。
- 会话 ID 和通知模式以会话状态 JSON 为准,由会话工具刷新本表;不要手工改行。通知模式变更须经用户确认后运行 `set-notification`。
""".format(
        profile=payload["profile"], created_at=payload["created_at"], protocol=PROTOCOL_VERSION,
        session_mode=payload["session_mode"], rows="\n".join(rows),
    )
    encoded = content.encode("utf-8")
    write_atomic(REGISTRY_FILE, encoded, 0o644)
    print(f"SESSION_REGISTRY_OK | departments={len(rows)}")
    return 0


def cmd_show(args) -> int:
    payload = load()
    rows = []
    for department, item in sorted(payload["departments"].items()):
        rows.append(
            f"{department} | {item['step']} | thread:{item.get('thread_id') or '-'} | "
            f"previous:{item.get('previous_thread_id') or '-'} | op:{item.get('operation_id') or '-'}"
        )
    print("\n".join(rows))
    return 0


def cmd_mark(args) -> int:
    if args.step not in STEPS - {"pending"}:
        raise ValueError("mark step 非法")
    payload = load()
    item = entry(payload, args.department)
    current = item["step"]
    if current == "failed":
        failed_from = item.get("failed_from")
        expected = {"pending": "created", "created": "onboarded", "onboarded": "registered"}.get(failed_from)
        if args.step != expected:
            raise ValueError(f"失败重试必须从上次成功点继续: {failed_from} -> {expected}")
    elif args.step not in ALLOWED.get(current, set()):
        raise ValueError(f"非法会话状态转换: {current} -> {args.step}")
    evidence = clean("evidence", args.evidence)
    if args.step == "created":
        if item.get("thread_id"):
            raise ValueError("created 不能覆盖已登记的 thread-id")
        item["thread_id"] = clean_thread_id(args.thread_id)
    elif args.step in {"onboarded", "registered"}:
        if not args.thread_id or args.thread_id != item.get("thread_id"):
            raise ValueError("onboarded / registered 必须提供与已记录值一致的 thread-id")
    if args.step in {"onboarded", "registered"} and not item.get("thread_id"):
        raise ValueError("尚未记录 thread-id")
    if args.step == "failed":
        item["failed_from"] = current
    else:
        item["failed_from"] = ""
    item["step"] = args.step
    item["note"] = args.note.strip()
    item["evidence"] = evidence
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_OK | {args.department} | {args.step} | {item.get('thread_id') or '-'} | {item.get('operation_id') or '-'}")
    return 0


def cmd_begin_switch(args) -> int:
    payload = load()
    item = entry(payload, args.department)
    if item["step"] != "registered" or item.get("thread_id") != args.old_thread_id:
        raise ValueError("只能从已登记且 ID 匹配的旧会话开始换班")
    if item.get("previous_thread_id") or item.get("operation_id", "").startswith("SWITCH-"):
        raise ValueError("上一次换班尚未收口，不能覆盖 previous_thread_id")
    item["previous_thread_id"] = item["thread_id"]
    item["thread_id"] = ""
    item["step"] = "pending"
    item["operation_id"] = "SWITCH-" + uuid.uuid4().hex[:10].upper()
    item["note"] = clean("reason", args.reason)
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_SWITCH_READY | {args.department} | {item['operation_id']} | {item['previous_thread_id']}")
    return 0


def cmd_restore_old(args) -> int:
    payload = load()
    item = entry(payload, args.department)
    if not item.get("operation_id", "").startswith("SWITCH-"):
        raise ValueError("当前不是换班操作")
    if not item.get("previous_thread_id") or item["step"] not in {"pending", "failed", "created", "onboarded", "registered"}:
        raise ValueError("没有可恢复的旧会话")
    note = clean("note", args.note)
    new_thread_id = item.get("thread_id", "")
    archive_evidence = args.evidence.strip()
    if new_thread_id:
        if not archive_evidence or not valid_archive_receipt(archive_evidence, new_thread_id):
            raise ValueError(
                "restore-old 在新会话已创建后，必须提供精确绑定新 thread_id 的归档回执"
            )
        evidence = clean("evidence", archive_evidence)
    else:
        if item["step"] not in {"pending", "failed"}:
            raise ValueError("无新 thread_id 时只能从创建前失败恢复旧会话")
        if item["step"] == "failed" and item.get("failed_from") != "pending":
            raise ValueError("当前失败阶段已应存在新 thread_id，拒绝猜测恢复")
        evidence = note
    item["thread_id"] = item["previous_thread_id"]
    item["previous_thread_id"] = ""
    item["step"] = "registered"
    item["failed_from"] = ""
    item["operation_id"] = "ACTIVE-" + uuid.uuid4().hex[:10].upper()
    item["note"] = note
    item["evidence"] = evidence
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_RESTORED | {args.department} | {item['thread_id']}")
    return 0


def cmd_finish_switch(args) -> int:
    payload = load()
    item = entry(payload, args.department)
    if not item.get("operation_id", "").startswith("SWITCH-"):
        raise ValueError("当前不是换班操作")
    if item["step"] != "registered" or item.get("thread_id") != args.new_thread_id or not item.get("previous_thread_id"):
        raise ValueError("新会话尚未登记或换班状态不完整")
    evidence = clean("evidence", args.evidence)
    if not valid_archive_receipt(evidence, item["previous_thread_id"]):
        raise ValueError(
            "finish-switch 归档回执必须精确绑定 previous_thread_id、包含 archived=true，"
            "并注明 host 或 user_confirmation"
        )
    item["previous_thread_id"] = ""
    item["operation_id"] = "ACTIVE-" + uuid.uuid4().hex[:10].upper()
    item["note"] = evidence
    item["evidence"] = evidence
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_SWITCH_DONE | {args.department} | {item['thread_id']}")
    return 0


def cmd_set_notification(args) -> int:
    payload = load()
    actor = clean("actor", args.actor)
    expected_actor = registered_lead_actor(payload)
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor};该字段只作审计声明")
    item = entry(payload, args.department)
    item["notification_mode"] = args.mode
    item["note"] = clean("evidence", args.evidence)
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_NOTIFICATION_OK | {args.department} | {args.mode}")
    return 0


def cmd_retire(args) -> int:
    payload = load()
    actor = clean("actor", args.actor)
    expected_actor = registered_lead_actor(payload)
    if actor != expected_actor:
        raise ValueError(f"actor 必须匹配当前已登记统筹会话: {expected_actor};该字段只作审计声明")
    item = entry(payload, args.department)
    if item.get("role_id") == "lead":
        raise ValueError("统筹部会话不能通过 retire 退役")
    if item["step"] != "registered" or not item.get("thread_id") or item.get("previous_thread_id"):
        raise ValueError("只允许退役无换班事务的已登记部门会话")
    thread_id = item["thread_id"]
    evidence = clean("evidence", args.evidence, max_chars=1000)
    if not valid_archive_receipt(evidence, thread_id):
        raise ValueError("retire 必须提供精确绑定当前 thread_id 的真实归档回执")
    history = list(item["lifecycle_history"])
    history.append({
        "event": "retired", "at": now_iso(), "actor": actor,
        "evidence": evidence, "thread_id": thread_id,
    })
    item["lifecycle_history"] = history
    item["step"] = "pending"
    item["thread_id"] = ""
    item["previous_thread_id"] = ""
    item["failed_from"] = ""
    item["operation_id"] = "RETIRED-" + uuid.uuid4().hex[:10].upper()
    item["note"] = evidence
    item["evidence"] = evidence
    item["updated_at"] = now_iso()
    save(payload)
    print(f"SESSION_RETIRED | {args.department} | thread_id={thread_id}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="agent-team 会话创建/换班恢复状态")
    sub = parser.add_subparsers(dest="cmd", required=True)
    show = sub.add_parser("show")
    show.set_defaults(func=cmd_show)
    rebuild = sub.add_parser("rebuild-registry")
    rebuild.set_defaults(func=cmd_rebuild_registry)
    mark = sub.add_parser("mark")
    mark.add_argument("--department", required=True)
    mark.add_argument("--step", required=True, choices=sorted(STEPS - {"pending"}))
    mark.add_argument("--thread-id", default="")
    mark.add_argument("--note", default="")
    mark.add_argument("--evidence", required=True)
    mark.set_defaults(func=cmd_mark)
    switch = sub.add_parser("begin-switch")
    switch.add_argument("--department", required=True)
    switch.add_argument("--old-thread-id", required=True)
    switch.add_argument("--reason", required=True)
    switch.set_defaults(func=cmd_begin_switch)
    restore = sub.add_parser("restore-old")
    restore.add_argument("--department", required=True)
    restore.add_argument("--note", required=True)
    restore.add_argument("--evidence", default="")
    restore.set_defaults(func=cmd_restore_old)
    finish = sub.add_parser("finish-switch")
    finish.add_argument("--department", required=True)
    finish.add_argument("--new-thread-id", required=True)
    finish.add_argument("--evidence", required=True)
    finish.set_defaults(func=cmd_finish_switch)
    notification = sub.add_parser("set-notification")
    notification.add_argument("--department", required=True)
    notification.add_argument("--mode", choices=("auto", "manual"), required=True)
    notification.add_argument("--evidence", required=True)
    notification.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    notification.set_defaults(func=cmd_set_notification)
    retire = sub.add_parser("retire")
    retire.add_argument("--department", required=True)
    retire.add_argument("--actor", required=True, help="当前已登记统筹会话，格式：统筹部/会话ID")
    retire.add_argument("--evidence", required=True)
    retire.set_defaults(func=cmd_retire)
    args = parser.parse_args()
    try:
        with state_lock():
            return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"SESSION_ERROR | {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
