"""Focused direct-report checks using the existing Hermes Python/MCP runtime."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

APP_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = APP_ROOT / "scripts/f1-status-report.py"
FROZEN_SCRIPT = APP_ROOT / "scripts/f1-status-mcp.py"
NODE = APP_ROOT / ".local/toolchains/node-v24.18.0-darwin-arm64/bin/node"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


report = load_module("f1_status_report", SCRIPT)
fixtures = load_module("f1_status_mcp_fixtures", Path(__file__).with_name("test_site_status_mcp.py"))


def healthy_sample() -> dict:
    now = datetime.now(timezone.utc)
    value = fixtures.complete_sample(now)
    parts = value["components"]
    db = parts["database"]
    value["status"] = db["status"] = db["rss"]["status"] = "healthy"
    db["reasons"] = []
    empty = {"count": 0, "oldestAt": None, "oldestAgeMs": None}
    recent = fixtures.status.timestamp(now - timedelta(minutes=5))
    previous = fixtures.status.timestamp(now - timedelta(minutes=20))
    for item in db["rss"]["sources"]:
        item.update({"status": "healthy", "reasons": [], "lastAttemptAt": recent, "lastSuccessAt": recent, "lastSuccessAgeMs": 300000, "latestSucceededSlotAt": recent, "previousSucceededSlotAt": previous, "latestSucceededScheduledAt": recent, "previousSucceededScheduledAt": previous})
        item["candidateCounts"] = {key: 0 for key in item["candidateCounts"]}
        for key in ("backlog", "missingCurrentDraft", "awaitingReview", "queuedPublications"):
            item[key] = dict(empty)
    pipeline = db["pipeline"]
    pipeline.update({"status": "healthy", "unknownOperations": 0, "currentRevisionRefinerUnknown": 0, "existingUnknown": 0, "newUnknown": 0, "terminalFailedOutbox": 0, "unresolvedOperations": dict(empty), "unresolvedOutbox": dict(empty)})
    pipeline["unknownByOwner"] = {key: 0 for key in pipeline["unknownByOwner"]}
    db["backupPoint"].update({"recoveryPointAt": recent, "completedAt": recent, "ageMs": 300000})
    parts["backup"].update({"status": "healthy", "reasons": [], "point": dict(db["backupPoint"]), "offHostReadCompletedAt": recent, "applicationDrillCompletedAt": recent})
    parts["http"][1].update({"status": "healthy", "reasons": [], "statusCode": 200, "semantic": "public-real-snapshot"})
    parts["storage"].update({"status": "healthy", "reasons": [], "growth": {"status": "observed", "availableBytesChangePerHour": 0, "baselineAt": fixtures.status.timestamp(now - timedelta(minutes=1)), "baselineAvailableBytes": 500, "intervalMs": 60000, "scope": "in-memory-comparison"}})
    return fixtures.status.validate_result(value, now)


def invoke_main(arguments=None):
    stdout, stderr = io.StringIO(), io.StringIO()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        code = report.main([] if arguments is None else arguments)
    return code, stdout.getvalue(), stderr.getvalue()


class IdentityTests(unittest.TestCase):
    def test_pinned_bytes_execute_once_with_fixed_sibling_identity(self):
        self.assertEqual(hashlib.sha256(FROZEN_SCRIPT.read_bytes()).hexdigest(), report.FROZEN_SHA256)
        self.assertEqual(report.FROZEN_MODULE_PATH, FROZEN_SCRIPT)
        frozen = report._load_frozen_module()
        self.assertEqual(frozen.__file__, str(FROZEN_SCRIPT))
        self.assertEqual(frozen.SCRIPT_PATH, FROZEN_SCRIPT.with_name("site-status.ts"))
        self.assertEqual(frozen.COMMAND_TIMEOUT_SECONDS, 24)
        self.assertLess(report.TOTAL_TIMEOUT_SECONDS + 0.5, 30)
        frozen.CAPACITY_BASELINE = {"old": "must not survive another invocation"}
        self.assertIsNone(report._load_frozen_module().CAPACITY_BASELINE)

    def test_replacement_after_hash_cannot_change_the_executed_bytes(self):
        original_hash = hashlib.sha256
        with tempfile.TemporaryDirectory(prefix="f1-report-identity-") as directory:
            sibling = Path(directory) / "f1-status-mcp.py"
            source = FROZEN_SCRIPT.read_bytes()
            sibling.write_bytes(source)
            changed = False

            def replace_after_hash(data=b"", *args, **kwargs):
                nonlocal changed
                digest = original_hash(data, *args, **kwargs)
                if data == source and not changed:
                    changed = True
                    sibling.write_text("raise RuntimeError('replacement-must-not-execute')", encoding="utf-8")
                return digest

            with patch.object(report, "FROZEN_MODULE_PATH", sibling), patch.object(report.hashlib, "sha256", side_effect=replace_after_hash):
                frozen = report._load_frozen_module()
            self.assertTrue(changed)
            self.assertTrue(callable(frozen.execute_fixed))
            self.assertEqual(frozen.__file__, str(sibling))
            self.assertEqual(frozen.SCRIPT_PATH, sibling.resolve().with_name("site-status.ts"))

    def test_missing_tampered_or_oversized_dependency_never_executes(self):
        with tempfile.TemporaryDirectory(prefix="f1-report-reject-") as directory:
            sibling = Path(directory) / "f1-status-mcp.py"
            marker = Path(directory) / "executed"
            payloads = [None, f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')".encode(), b"x" * (report.MAX_MODULE_BYTES + 1)]
            for payload in payloads:
                with self.subTest(kind="missing" if payload is None else len(payload)):
                    if payload is not None:
                        sibling.write_bytes(payload)
                    with patch.object(report, "FROZEN_MODULE_PATH", sibling):
                        code, stdout, stderr = invoke_main()
                    self.assertEqual((code, stdout, stderr), (1, report.UNKNOWN_REPORT + "\n", ""))
                    self.assertFalse(marker.exists())

    def test_any_cli_arguments_rejected_before_loading_or_sampling(self):
        with patch.object(report, "_load_frozen_module") as load:
            for arguments in [["--help"], ["--sql", "SELECT private"], ["/private/config"], ["https://private.invalid"], ["$(touch private)"]]:
                self.assertEqual(invoke_main(arguments), (2, report.ARGUMENTS_REPORT + "\n", ""))
            load.assert_not_called()


class ReportTests(unittest.TestCase):
    def test_normal_failed_and_unknown_results_use_only_frozen_formatter(self):
        for value in [healthy_sample(), fixtures.complete_sample(), fixtures.status.unknown_result("SAMPLER_FAILED")]:
            with self.subTest(status=value["status"]):
                frozen = report._load_frozen_module()
                before = json.dumps(value, sort_keys=True)
                expected = frozen.render_report(value)
                with patch.object(report, "_load_frozen_module", return_value=frozen), patch.object(frozen, "execute_fixed", new_callable=AsyncMock, return_value=value) as sample, patch.object(frozen.mcp, "run", side_effect=AssertionError("MCP server must not start")) as serve, patch.object(frozen.mcp, "call_tool", new_callable=AsyncMock) as tool:
                    code, stdout, stderr = invoke_main()
                self.assertEqual((code, stdout, stderr), (0, expected + "\n", ""))
                sample.assert_awaited_once_with()
                serve.assert_not_called()
                tool.assert_not_awaited()
                self.assertEqual(json.dumps(value, sort_keys=True), before)
                self.assertIn("北京时间（UTC+8）", stdout)
                self.assertIn("Admin", stdout)
                self.assertIn("未知", stdout)
                self.assertNotIn("采集和备份任务卡住", stdout)
                self.assertNotIn("之后无采集", stdout)

    def test_malformed_expired_or_inconsistent_dto_becomes_fixed_unknown(self):
        failed = fixtures.complete_sample()
        inconsistent = {**failed, "status": "healthy"}
        extra = {**failed, "path": "/private/secret-token"}
        expired = fixtures.sample(datetime.now(timezone.utc) - timedelta(seconds=61))
        for value in [None, inconsistent, extra, expired]:
            frozen = report._load_frozen_module()
            with self.subTest(value_type=type(value).__name__), patch.object(report, "_load_frozen_module", return_value=frozen), patch.object(frozen, "execute_fixed", new_callable=AsyncMock, return_value=value) as sample:
                self.assertEqual(invoke_main(), (1, report.UNKNOWN_REPORT + "\n", ""))
                sample.assert_awaited_once_with()

    def test_maximum_allowed_counts_and_ages_keep_the_complete_report(self):
        value = fixtures.complete_sample()
        maximum = 9_007_199_254_740_991
        db = value["components"]["database"]
        for source in db["rss"]["sources"]:
            source["lastSuccessAgeMs"] = maximum
            source["candidateCounts"] = {key: maximum for key in source["candidateCounts"]}
            for key in ("backlog", "missingCurrentDraft", "awaitingReview", "queuedPublications"):
                source[key] = {"count": maximum, "oldestAt": source["lastSuccessAt"], "oldestAgeMs": maximum}
        pipeline = db["pipeline"]
        for key in ("unknownOperations", "currentRevisionRefinerUnknown", "existingUnknown", "newUnknown", "terminalFailedOutbox"):
            pipeline[key] = maximum
        pipeline["unknownByOwner"] = {key: maximum for key in pipeline["unknownByOwner"]}
        for key in ("unresolvedOperations", "unresolvedOutbox"):
            pipeline[key]["count"] = pipeline[key]["oldestAgeMs"] = maximum
        value["components"]["storage"].update({"availableBytes": maximum, "totalBytes": maximum})
        frozen = report._load_frozen_module()
        expected = frozen.render_report(frozen.validate_result(value))
        with patch.object(report, "_load_frozen_module", return_value=frozen), patch.object(frozen, "execute_fixed", new_callable=AsyncMock, return_value=value):
            code, stdout, stderr = invoke_main()
        self.assertEqual((code, stdout, stderr), (0, expected + "\n", ""))
        self.assertLessEqual(len(stdout.encode("utf-8")), report.MAX_REPORT_BYTES + 1)
        self.assertIn("9007199254740991", stdout)
        self.assertTrue(stdout.endswith("采集任务、备份任务的存活状态未采样，异常根因未查。\n"))

    def test_internal_stdout_stderr_and_exceptions_cannot_escape(self):
        def fail_loading():
            print("/private/secret-token stdout")
            print("/private/secret-token stderr", file=sys.stderr)
            raise RuntimeError("SELECT private FROM /private/database")

        with patch.object(report, "_load_frozen_module", side_effect=fail_loading):
            self.assertEqual(invoke_main(), (1, report.UNKNOWN_REPORT + "\n", ""))

    def test_report_limit_is_utf8_bytes_and_rejects_control_characters(self):
        maximum = "巡" * (report.MAX_REPORT_BYTES // 3) + "a" * (report.MAX_REPORT_BYTES % 3)
        self.assertEqual(len(maximum.encode("utf-8")), report.MAX_REPORT_BYTES)
        self.assertEqual(report._bounded_report(maximum), maximum)
        for invalid in [maximum + "巡", "", None, "巡检\x00", "巡检\x1b[31m", "巡检\r", "巡检\x7f"]:
            with self.subTest(kind=type(invalid).__name__), self.assertRaises(ValueError):
                report._bounded_report(invalid)
        frozen = report._load_frozen_module()
        with patch.object(report, "_load_frozen_module", return_value=frozen), patch.object(frozen, "execute_fixed", new_callable=AsyncMock, return_value=frozen.unknown_result("SAMPLER_FAILED")), patch.object(frozen, "render_report", return_value=maximum + "/private/secret-token"):
            self.assertEqual(invoke_main(), (1, report.UNKNOWN_REPORT + "\n", ""))

    def test_total_deadline_also_bounds_blocking_dependency_startup(self):
        previous = signal.getsignal(signal.SIGALRM)
        begin = time.monotonic()
        with patch.object(report, "TOTAL_TIMEOUT_SECONDS", 0.05), patch.object(report, "_load_frozen_module", side_effect=lambda: time.sleep(2)):
            self.assertEqual(invoke_main(), (1, report.UNKNOWN_REPORT + "\n", ""))
        self.assertLess(time.monotonic() - begin, 0.5)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))


class ProcessTests(unittest.TestCase):
    def run_cli(self, script: Path, env=None, timeout=29, input_text=""):
        clean = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
        clean.update(env or {})
        return subprocess.run([sys.executable, "-I", "-B", "-X", "utf8", str(script)], input=input_text, capture_output=True, text=True, encoding="utf-8", env=clean, timeout=timeout)

    def test_real_cli_ignores_stdin_pythonpath_and_returns_valid_unknown(self):
        with tempfile.TemporaryDirectory(prefix="f1-report-cli-") as directory:
            root = Path(directory)
            marker = root / "injected"
            (root / "sitecustomize.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()", encoding="utf-8")
            result = self.run_cli(SCRIPT, {"PYTHONPATH": str(root), "NODE_OPTIONS": "--bad-option-private", "F1_STATUS_NODE_PATH": str(NODE), "F1_STATUS_CONFIG_PATH": str(root / "missing.json")}, input_text="SELECT private FROM /private/database\n")
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, "")
            self.assertIn("状态未知（unknown）", result.stdout)
            self.assertIn("固定巡检配置不可用", result.stdout)
            self.assertIn("北京时间（UTC+8）", result.stdout)
            self.assertNotIn(directory, result.stdout)
            self.assertNotIn("private", result.stdout)
            self.assertFalse(marker.exists())
            self.assertEqual(list(root.glob("__pycache__")), [])

    def test_real_cli_rejects_args_without_executing_configured_runtime(self):
        with tempfile.TemporaryDirectory(prefix="f1-report-argv-") as directory:
            marker = Path(directory) / "executed"
            runtime = Path(directory) / "runtime"
            runtime.write_text(f"#!/bin/sh\n/usr/bin/touch '{marker}'\n", encoding="utf-8")
            runtime.chmod(0o700)
            result = subprocess.run([sys.executable, "-I", "-B", "-X", "utf8", str(SCRIPT), "--sql", "SELECT secret"], capture_output=True, text=True, env={"F1_STATUS_NODE_PATH": str(runtime), "F1_STATUS_CONFIG_PATH": str(marker)}, timeout=3)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (2, report.ARGUMENTS_REPORT + "\n", ""))
            self.assertFalse(marker.exists())

    def timeout_launcher(self, root: Path, outer_timeout: float | None):
        pids = root / "pids.json"
        producer = root / "producer.mts"
        producer.write_text(
            "import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n"
            "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\n"
            f"writeFileSync({json.dumps(str(pids))},JSON.stringify([process.pid,child.pid]));\n"
            "setInterval(()=>{},1000);\n", encoding="utf-8",
        )
        launcher = root / "launcher.py"
        launcher.write_text(
            "import importlib.util\n"
            f"spec=importlib.util.spec_from_file_location('report',{str(SCRIPT)!r})\n"
            "report=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(report)\n"
            "frozen=report._load_frozen_module()\nassert frozen.COMMAND_TIMEOUT_SECONDS == 24\n"
            f"frozen.SCRIPT_PATH=__import__('pathlib').Path({str(producer)!r})\n"
            f"frozen.NODE_PATH={str(NODE)!r}\nfrozen.CONFIG_PATH={str(root / 'fixed.json')!r}\n"
            "report._load_frozen_module=lambda: frozen\n"
            + (f"report.TOTAL_TIMEOUT_SECONDS={outer_timeout!r}\n" if outer_timeout is not None else "")
            + "raise SystemExit(report.main([]))\n", encoding="utf-8",
        )
        return launcher, pids

    def assert_processes_stopped(self, pids: list[int]):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            live = []
            for pid in pids:
                result = subprocess.run(["/bin/ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, timeout=1)
                state = result.stdout.strip()
                if state and not state.startswith("Z"):
                    live.append(pid)
            if not live:
                return
            time.sleep(0.02)
        self.fail(f"Isolated fixture processes still running: {live}")

    def check_timeout_cleanup(self, outer_timeout: float | None):
        with tempfile.TemporaryDirectory(prefix="f1-report-timeout-") as directory:
            launcher, pid_path = self.timeout_launcher(Path(directory), outer_timeout)
            try:
                begin = time.monotonic()
                result = self.run_cli(launcher)
                elapsed = time.monotonic() - begin
                self.assertTrue(pid_path.exists(), "fixture must actually launch both processes")
                pids = json.loads(pid_path.read_text(encoding="utf-8"))
                self.assertEqual(len(pids), 2)
                self.assert_processes_stopped(pids)
                self.assertEqual(result.stderr, "")
                if outer_timeout is None:
                    self.assertEqual(result.returncode, 0)
                    self.assertIn("巡检采样超时", result.stdout)
                    self.assertGreaterEqual(elapsed, 24)
                    self.assertLess(elapsed, 28.5)
                else:
                    self.assertEqual((result.returncode, result.stdout), (1, report.UNKNOWN_REPORT + "\n"))
                    self.assertLess(elapsed, 3)
            finally:
                if pid_path.exists():
                    pid = json.loads(pid_path.read_text(encoding="utf-8"))[0]
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_frozen_24_second_timeout_reaps_sampler_and_stops_grandchild(self):
        self.check_timeout_cleanup(None)

    def test_outer_deadline_cancellation_also_cleans_sampler_process_group(self):
        self.check_timeout_cleanup(0.8)


if __name__ == "__main__":
    unittest.main()
