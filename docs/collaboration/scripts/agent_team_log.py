#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent-team 事实事件追加器。

只做确定性机械工作:校验字段、生成带时区时间和唯一事件 ID、
在部门周日志末尾原子追加一条事实记录，并只返回短收据。
不读取或输出历史日志，不总结经验，不替代 Agent 判断事件事实。
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
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


UTF8_BOOTSTRAP_MARKER = "AGENT_TEAM_LOG_UTF8_BOOTSTRAPPED"
EVENT_TYPES = {"MILESTONE", "CHANGE", "CORRECTION", "DECISION", "INCIDENT"}
INITIATORS = {"user", "agent", "review", "external"}
PREFIXES = {
    "MILESTONE": "MIL",
    "CHANGE": "CHG",
    "CORRECTION": "COR",
    "DECISION": "DEC",
    "INCIDENT": "INC",
}
MAX_FIELD_CHARS = 500
FORMAL_START = "<!-- agent-team:formal-log:start -->"
FORMAL_END = "<!-- agent-team:formal-log:end -->"
TEMP_START = "<!-- agent-team:temporary-log:start -->"
TEMP_END = "<!-- agent-team:temporary-log:end -->"


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


def clean_field(name: str, value: str, *, required: bool = True) -> str:
    cleaned = value.strip()
    if required and not cleaned:
        raise ValueError(f"{name} 不能为空")
    if any(ch in cleaned for ch in ("\n", "\r", "|")):
        raise ValueError(f"{name} 不能包含换行或竖线")
    if any(ord(ch) < 32 for ch in cleaned):
        raise ValueError(f"{name} 不能包含控制字符")
    if len(cleaned) > MAX_FIELD_CHARS:
        raise ValueError(f"{name} 不能超过 {MAX_FIELD_CHARS} 个字符")
    return cleaned or "-"


def safe_department(name: str) -> Path:
    if not name or Path(name).name != name or name in {".", ".."}:
        raise ValueError("部门名非法")
    if DEPARTMENTS.is_symlink() or not DEPARTMENTS.is_dir():
        raise ValueError("部门目录不存在或为符号链接")
    department = DEPARTMENTS / name
    if department.is_symlink() or not department.is_dir():
        raise ValueError(f"部门不存在或为符号链接: {name}")
    logs = department / "日志"
    if logs.is_symlink() or not logs.is_dir():
        raise ValueError("日志路径不是已存在的普通目录")
    return logs


def use_dir_fd() -> bool:
    return os.name != "nt" and os.open in os.supports_dir_fd


def open_directory(name_or_path, *, dir_fd=None) -> int:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(name_or_path, flags, dir_fd=dir_fd) if dir_fd is not None else os.open(name_or_path, flags)
    if not stat.S_ISDIR(os.fstat(fd).st_mode):
        os.close(fd)
        raise ValueError("路径不是普通目录")
    return fd


@contextmanager
def logs_directory(department: str):
    logs = safe_department(department)
    if not use_dir_fd():
        yield logs, None
        return
    collab_fd = departments_fd = department_fd = logs_fd = -1
    try:
        collab_fd = open_directory(COLLAB)
        departments_fd = open_directory("部门", dir_fd=collab_fd)
        department_fd = open_directory(department, dir_fd=departments_fd)
        logs_fd = open_directory("日志", dir_fd=department_fd)
        yield logs, logs_fd
    finally:
        for fd in (logs_fd, department_fd, departments_fd, collab_fd):
            if fd >= 0:
                os.close(fd)


def safe_pointer(raw: str) -> str:
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = PROJECT / candidate
    try:
        lexical = Path(os.path.abspath(str(candidate)))
        relative = lexical.relative_to(PROJECT)
        current = PROJECT
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("pointer 不能经过符号链接")
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(PROJECT)
    except (OSError, ValueError) as exc:
        raise ValueError("pointer 必须指向项目内已存在的非链接路径") from exc
    return str(resolved.relative_to(PROJECT))


@contextmanager
def log_lock(department: str):
    if LOCKS.exists() and (LOCKS.is_symlink() or not LOCKS.is_dir()):
        raise ValueError("锁目录不安全")
    LOCKS.mkdir(mode=0o700, exist_ok=True)
    lock_name = "log-" + department + ".lock"
    lock_path = LOCKS / lock_name
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    if use_dir_fd():
        collab_fd = locks_fd = -1
        try:
            collab_fd = open_directory(COLLAB)
            locks_fd = open_directory(".locks", dir_fd=collab_fd)
            fd = os.open(lock_name, flags, 0o600, dir_fd=locks_fd)
        finally:
            if locks_fd >= 0:
                os.close(locks_fd)
            if collab_fd >= 0:
                os.close(collab_fd)
    else:
        fd = os.open(lock_path, flags, 0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        raise ValueError("日志锁不是普通文件")
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


def write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("写入失败")
        view = view[written:]


def week_info(now: dt.datetime) -> tuple[str, str, str]:
    iso_year, iso_week, _ = now.date().isocalendar()
    monday = now.date() - dt.timedelta(days=now.date().weekday())
    sunday = monday + dt.timedelta(days=6)
    return f"{iso_year}-W{iso_week:02d}", monday.isoformat(), sunday.isoformat()


def create_week_file(path: Path, department: str, week: str, start: str, end: str, logs_fd: int | None) -> None:
    header = (
        f"---\n部门: {department}\n覆盖: {start} ~ {end}\n---\n\n"
        f"# {department} · 日志 · {week}\n\n"
        "> 冷历史，默认不读。正式部门与临时外包物理分区；只记录改变项目轨迹的事实。\n\n"
        "## 正式部门日志\n\n"
        f"{FORMAL_START}\n{FORMAL_END}\n\n"
        "## 临时外包日志\n\n"
        "> 临时任务局部判断不代表父部门或项目正式结论。\n\n"
        f"{TEMP_START}\n{TEMP_END}\n"
    ).encode("utf-8")
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path.name, flags, 0o600, dir_fd=logs_fd) if logs_fd is not None else os.open(path, flags, 0o600)
    except FileExistsError:
        return
    try:
        write_all(fd, header)
        os.fsync(fd)
    finally:
        os.close(fd)


def section_layout(text: str) -> str:
    markers = (FORMAL_START, FORMAL_END, TEMP_START, TEMP_END)
    counts = [text.count(marker) for marker in markers]
    if counts == [1, 1, 1, 1]:
        if not (
            text.index(FORMAL_START) < text.index(FORMAL_END)
            < text.index(TEMP_START) < text.index(TEMP_END)
        ):
            raise ValueError("周日志分区标记顺序损坏")
        return text
    if any(counts):
        raise ValueError("周日志分区标记不完整，拒绝猜测修复")

    # 兼容旧平铺日志：保留头部，把既有事实事件原样迁入正式板块。
    lines = text.splitlines(keepends=True)
    first_event = next((index for index, line in enumerate(lines) if line.startswith("- ") and " | " in line), len(lines))
    prefix = "".join(lines[:first_event]).rstrip() + "\n\n"
    events = "".join(lines[first_event:]).strip()
    formal_body = (events + "\n") if events else ""
    return (
        prefix
        + "## 正式部门日志\n\n"
        + FORMAL_START + "\n" + formal_body + FORMAL_END + "\n\n"
        + "## 临时外包日志\n\n"
        + "> 临时任务局部判断不代表父部门或项目正式结论。\n\n"
        + TEMP_START + "\n" + TEMP_END + "\n"
    )


def replace_file(path: Path, data: bytes, logs_fd: int | None) -> None:
    temp_name = f".{path.name}.{uuid.uuid4().hex}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp_name, flags, 0o600, dir_fd=logs_fd) if logs_fd is not None else os.open(path.parent / temp_name, flags, 0o600)
    try:
        write_all(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        if logs_fd is not None:
            os.replace(temp_name, path.name, src_dir_fd=logs_fd, dst_dir_fd=logs_fd)
            os.fsync(logs_fd)
        else:
            os.replace(path.parent / temp_name, path)
    finally:
        if logs_fd is not None:
            try:
                os.unlink(temp_name, dir_fd=logs_fd)
            except FileNotFoundError:
                pass
        else:
            (path.parent / temp_name).unlink(missing_ok=True)


def insert_event(text: str, *, event_line: str, task_id: str, executor_type: str, executor_id: str) -> str:
    text = section_layout(text)
    if executor_type == "formal":
        position = text.index(FORMAL_END)
        return text[:position] + event_line + text[position:]

    position = text.index(TEMP_END)
    section_start = text.index(TEMP_START) + len(TEMP_START)
    temporary_body = text[section_start:position]
    task_marker = f"<!-- agent-team:temporary-task:{task_id} -->"
    if task_marker in temporary_body:
        group_start = text.index(task_marker, section_start)
        next_group = text.find("\n### TASK-", group_start)
        insert_at = position if next_group < 0 or next_group > position else next_group
        return text[:insert_at].rstrip() + "\n" + event_line + "\n" + text[insert_at:].lstrip("\n")
    group = (
        f"\n### {task_id}\n\n"
        f"{task_marker}\n"
        f"> executor_type:temporary · executor_id:{executor_id}\n\n"
        f"{event_line}"
    )
    return text[:position] + group + text[position:]


def append_event(args: argparse.Namespace) -> int:
    event_type = args.type.upper()
    if event_type not in EVENT_TYPES:
        raise ValueError("type 只允许: " + ", ".join(sorted(EVENT_TYPES)))
    if args.initiator not in INITIATORS:
        raise ValueError("initiator 只允许: " + ", ".join(sorted(INITIATORS)))

    department = clean_field("department", args.department)
    task_id = clean_field("task-id", args.task_id)
    if task_id != "PROJECT" and not re.fullmatch(r"TASK-[0-9]{8}-[A-Z0-9]{6}", task_id):
        raise ValueError("task-id 必须是 TASK-YYYYMMDD-XXXXXX 或 PROJECT")
    executor_type = args.executor_type
    if executor_type not in {"formal", "temporary"}:
        raise ValueError("executor-type 只允许 formal 或 temporary")
    executor_id = clean_field("executor-id", args.executor_id or "", required=executor_type == "temporary")
    parent_department = clean_field(
        "parent-department", args.parent_department or department, required=executor_type == "temporary"
    )
    if executor_type == "temporary":
        if task_id == "PROJECT":
            raise ValueError("临时外包日志必须绑定具体 TASK")
        if parent_department != department:
            raise ValueError("临时外包日志必须写入父部门周日志")
        if TASKS.is_symlink() or not TASKS.is_dir():
            raise ValueError("tasks 目录缺失或为符号链接")
        task_path = TASKS / f"{task_id}.json"
        if task_path.is_symlink() or not task_path.is_file():
            raise ValueError("临时外包日志绑定的权威 TASK 不存在或不安全")
        task_payload = strict_json_loads(task_path.read_text(encoding="utf-8"), str(task_path))
        temporary = task_payload.get("temporary_executor")
        if not isinstance(temporary, dict):
            raise ValueError("TASK 未绑定临时执行者，拒绝写临时日志")
        if task_payload.get("department") != department or temporary.get("parent_department") != department:
            raise ValueError("日志父部门与 TASK 真值不一致")
        if temporary.get("executor_type") != "temporary" or temporary.get("executor_id") != executor_id:
            raise ValueError("日志执行者与 TASK 真值不一致")
    else:
        executor_id = "-"
        parent_department = department
    fact = clean_field("fact", args.fact)
    result = clean_field("result", args.result)
    pointer = safe_pointer(clean_field("pointer", args.pointer))
    needs_context = event_type != "MILESTONE"
    trigger = clean_field("trigger", args.trigger or "", required=needs_context)
    impact = clean_field("impact", args.impact or "", required=needs_context)

    now = dt.datetime.now().astimezone()
    timestamp = now.isoformat(timespec="minutes")
    week, start, end = week_info(now)
    with log_lock(department):
        with logs_directory(department) as (logs, logs_fd):
            log_path = logs / f"{week}.md"
            create_week_file(log_path, department, week, start, end, logs_fd)
            event_id = f"{PREFIXES[event_type]}-{now:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:6].upper()}"
            line = (
                f"- {timestamp} | {event_id} | {event_type} | task:{task_id} | initiator:{args.initiator} | "
                f"executor_type:{executor_type} | executor_id:{executor_id} | parent_department:{parent_department} | "
                f"fact:{fact} | trigger:{trigger} | impact:{impact} | result:{result} | -> {pointer}\n"
            )
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(log_path.name, flags, dir_fd=logs_fd) if logs_fd is not None else os.open(log_path, flags)
            try:
                file_stat = os.fstat(fd)
                if not stat.S_ISREG(file_stat.st_mode):
                    raise ValueError("周日志不是普通文件")
                if file_stat.st_nlink != 1:
                    raise ValueError("周日志存在硬链接，拒绝更新")
                with os.fdopen(fd, "r", encoding="utf-8", newline="") as handle:
                    fd = -1
                    current = handle.read()
            finally:
                if fd >= 0:
                    os.close(fd)
            updated = insert_event(
                current, event_line=line, task_id=task_id,
                executor_type=executor_type, executor_id=executor_id,
            )
            replace_file(log_path, updated.encode("utf-8"), logs_fd)

    relative = log_path.relative_to(PROJECT)
    print(f"LOG_OK | {timestamp} | {task_id} | {event_id} | {relative}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="agent-team 事实事件追加器")
    sub = parser.add_subparsers(dest="cmd", required=True)
    append = sub.add_parser("append", help="向部门周日志末尾追加一条事实事件")
    append.add_argument("--department", required=True)
    append.add_argument("--task-id", default="PROJECT")
    append.add_argument("--type", required=True)
    append.add_argument("--initiator", required=True)
    append.add_argument("--fact", required=True)
    append.add_argument("--trigger", default="")
    append.add_argument("--impact", default="")
    append.add_argument("--result", required=True)
    append.add_argument("--pointer", required=True)
    append.add_argument("--executor-type", choices=("formal", "temporary"), default="formal")
    append.add_argument("--executor-id", default="")
    append.add_argument("--parent-department", default="")
    append.set_defaults(func=append_event)
    args = parser.parse_args()
    try:
        return args.func(args)
    except (OSError, ValueError) as exc:
        print(f"LOG_ERROR | {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
