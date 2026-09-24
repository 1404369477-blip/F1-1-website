#!/usr/bin/env python3
"""One-shot text entry for Hermes quick_commands; no arguments or model calls.

Operator launch: env -i with fixed F1_STATUS_NODE_PATH/F1_STATUS_CONFIG_PATH,
then the existing Hermes Python with -I -B -X utf8 and this script.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
import os
from pathlib import Path
import signal
import sys
import time
from types import ModuleType

FROZEN_MODULE_PATH = Path(__file__).resolve().with_name("f1-status-mcp.py")
FROZEN_SHA256 = "dc9d705ad5ec96e79d28de211fd2eda36815d4934e1d0c81179e96a4216b3dd2"
MAX_MODULE_BYTES = 131_072
MAX_REPORT_BYTES = 16_384
TOTAL_TIMEOUT_SECONDS = 27

UNKNOWN_REPORT = "\n".join((
    "F1+1 巡检：状态未知（unknown）。",
    "巡检报告不可用；未取得经过完整校验的本次结果。",
    "网站、RSS、处理队列、备份、容量与 Admin 登录可用性：未知。",
    "本次未判断站点是否故障，异常根因未查。",
))
ARGUMENTS_REPORT = "\n".join((
    "F1+1 巡检：状态未知（unknown）。",
    "调用已拒绝：此入口不接受参数，未执行巡检。",
    "网站、RSS、处理队列、备份、容量与 Admin 登录可用性：未知。",
))


class _DeadlineExpired(BaseException):
    """Escape blocking startup too; asyncio.run still cancels its child tasks."""


def _expire(_signum, _frame) -> None:
    raise _DeadlineExpired()


@contextmanager
def _deadline():
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    signal.signal(signal.SIGALRM, _expire)
    try:
        signal.setitimer(signal.ITIMER_REAL, TOTAL_TIMEOUT_SECONDS)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.001, previous_timer[0] - (time.monotonic() - started)), previous_timer[1])


def _load_frozen_module() -> ModuleType:
    # Read once: a replacement after verification cannot change executed bytes.
    with FROZEN_MODULE_PATH.open("rb") as stream:
        source = stream.read(MAX_MODULE_BYTES + 1)
    if len(source) > MAX_MODULE_BYTES or hashlib.sha256(source).hexdigest() != FROZEN_SHA256:
        raise ValueError("FROZEN_MODULE_IDENTITY_INVALID")
    module = ModuleType("_f1_status_report_frozen")
    module.__file__ = str(FROZEN_MODULE_PATH)
    sys.modules[module.__name__] = module
    try:
        exec(compile(source, str(FROZEN_MODULE_PATH), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(module.__name__, None)
        raise
    return module


def _bounded_report(report: str) -> str:
    if not isinstance(report, str) or not report or len(report.encode("utf-8")) > MAX_REPORT_BYTES:
        raise ValueError("REPORT_INVALID")
    if any(ord(char) < 32 and char != "\n" or ord(char) == 127 for char in report):
        raise ValueError("REPORT_INVALID")
    return report


def _report_once() -> str:
    frozen = _load_frozen_module()
    # Fresh module per invocation: no second sample, retained baseline, or MCP server.
    # The frozen sampler owns its 24s timeout and process-group kill/reap in finally.
    value = asyncio.run(frozen.execute_fixed())
    return _bounded_report(frozen.render_report(frozen.validate_result(value)))


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    report, exit_code = ARGUMENTS_REPORT if arguments else UNKNOWN_REPORT, 2 if arguments else 1
    if not arguments:
        try:
            with _deadline(), open(os.devnull, "w", encoding="utf-8") as silent, redirect_stdout(silent), redirect_stderr(silent):
                report = _report_once()
                exit_code = 0
        except BaseException:
            # Never return exception text, paths, DTOs, credentials, or partial output.
            report, exit_code = UNKNOWN_REPORT, 1
    try:
        sys.stdout.write(report + "\n")
        sys.stdout.flush()
    except (OSError, UnicodeError):
        return 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
