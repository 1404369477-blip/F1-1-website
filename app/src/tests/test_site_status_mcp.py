"""Use the existing Hermes Python / MCP installation; no test dependencies are added."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

APP_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = APP_ROOT / "scripts/f1-status-mcp.py"
NODE = APP_ROOT / ".local/toolchains/node-v24.18.0-darwin-arm64/bin/node"
spec = importlib.util.spec_from_file_location("f1_status_mcp", SCRIPT)
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


def sample(now: datetime | None = None, available: int = 500) -> dict:
    now = now or datetime.now(timezone.utc)
    observed = status.timestamp(now)
    result = status.unknown_result("SAMPLER_FAILED", now)
    result["status"] = "failed"
    result["reasons"] = []
    result["components"] = {
        "database": {"status": "unknown", "observedAt": observed, "reasons": ["DATABASE_READ_FAILED"], "identity": None, "control": None, "rss": None, "pipeline": None, "backupPoint": None},
        "backup": {"status": "unknown", "observedAt": observed, "reasons": ["BACKUP_DATABASE_UNKNOWN"], "databaseObservedAt": observed, "point": None, "maxRecoveryPointAgeMs": 900000, "manifestVerified": None, "offHostSignatureVerified": None, "applicationSignatureVerified": None, "offHostReadCompletedAt": None, "applicationDrillCompletedAt": None, "verificationScope": "registered-point-and-pinned-signed-receipts", "offHostCiphertextReread": False, "restoreExecuted": False},
        "http": [
            {"status": "failed", "observedAt": observed, "reasons": ["HTTP_TIMEOUT"], "probe": "local-public", "statusCode": None, "durationMs": 4001, "semantic": None, "authenticatedPrivateAccess": "not-applicable"},
            {"status": "unknown", "observedAt": observed, "reasons": ["PUBLIC_TARGET_IDENTITY_UNKNOWN"], "probe": "public-https", "statusCode": None, "durationMs": 0, "semantic": None, "authenticatedPrivateAccess": "not-applicable"},
            {"status": "healthy", "observedAt": observed, "reasons": [], "probe": "admin-auth", "statusCode": 404, "durationMs": 4, "semantic": "loopback-perimeter-rejection", "authenticatedPrivateAccess": "unknown"},
        ],
        "processes": [{"status": "healthy", "observedAt": observed, "reasons": [], "service": name, "state": "running", "pid": 100 + i, "startedAt": "Thu Sep 10 11:35:16 2026"} for i, name in enumerate(status.SERVICE_LABELS)],
        "storage": {"status": "unknown", "observedAt": observed, "reasons": ["STORAGE_GROWTH_BASELINE_UNAVAILABLE"], "capacityStatus": "healthy", "availableBytes": available, "totalBytes": 1000, "filesystemRef": "a" * 64, "warningAvailableBytes": 100, "failedAvailableBytes": 20, "growth": {"status": "unknown", "availableBytesChangePerHour": None, "baselineAt": None, "baselineAvailableBytes": None, "intervalMs": None, "scope": "single-sample"}},
    }
    return result


def complete_sample(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    value = sample(now)
    observed = value["observedAt"]
    succeeded = status.timestamp(now - timedelta(hours=12, minutes=55))
    source_samples = []
    for index, source_id in enumerate(("motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"), 1):
        queue = {"count": index, "oldestAt": succeeded, "oldestAgeMs": 46_500_000}
        source_samples.append({
            "sourceId": source_id, "status": "failed", "observedAt": observed, "reasons": ["RSS_SUCCESS_STALE"],
            "enabled": True, "lastAttemptAt": succeeded, "lastSuccessAt": succeeded, "lastSuccessAgeMs": 46_500_000,
            "latestAttemptStatus": "succeeded", "latestSucceededSlotAt": succeeded,
            "previousSucceededSlotAt": status.timestamp(now - timedelta(hours=13, minutes=10)), "actualSucceededSlotIntervalMs": 900000,
            "latestSucceededScheduledAt": succeeded, "previousSucceededScheduledAt": status.timestamp(now - timedelta(hours=13, minutes=10)), "scheduledSucceededSlotIntervalMs": 900000,
            "candidateCounts": {"pending_review": index, "approved": index, "published": 10, "rejected": 0, "other": 0},
            "backlog": dict(queue), "missingCurrentDraft": dict(queue),
            "awaitingReview": {"count": 0, "oldestAt": None, "oldestAgeMs": None}, "queuedPublications": dict(queue),
        })
    backup_point = {
        "packageRef": "b" * 64, "recoveryPointAt": status.timestamp(now - timedelta(hours=13)),
        "completedAt": status.timestamp(now - timedelta(hours=13) + timedelta(minutes=2)), "ageMs": 46_800_000,
        **{key: "c" * 64 for key in ("manifestSha256", "databaseSnapshotSha256", "deploymentManifestSha256", "releaseSha256", "schemaSha256", "writerAuthorityReceiptSha256", "projectionManifestSha256")},
        "writerEpoch": 1, "recoveryEpoch": 1, "projectionGeneration": 1,
    }
    value["components"]["database"] = {
        "status": "failed", "observedAt": observed, "reasons": ["RSS_SUCCESS_STALE", "UNKNOWN_OPERATIONS_PRESENT"],
        "identity": {"deploymentManifestSha256": "c" * 64, "schemaSha256": "c" * 64, "releaseSha256": "c" * 64, "userVersion": 10},
        "control": {"status": "healthy", "observedAt": observed, "phase": "live", "globalStopState": "clear", "emergencyStopState": "clear", "recoveryState": "ready", "deletionFenceState": "clear", "publicationFenceState": "clear", **{key: 1 for key in ("writerEpoch", "recoveryEpoch", "sourceConfigEpoch", "sourceSafetyEpoch", "authorizationVersion", "policyEpoch")}, "writerAuthorityReceiptSha256": "c" * 64},
        "rss": {"status": "failed", "observedAt": observed, "cutoffAt": "2026-09-05T02:30:00.000Z", "expectedSlotIntervalMs": 900000, "staleSuccessAfterMs": 900000, "failedSuccessAfterMs": 1800000, "sources": source_samples},
        "pipeline": {"status": "degraded", "observedAt": observed, "unknownOperations": 19, "unknownScope": "recorded_unresolved_operations_all_revisions", "unknownByOwner": {"rss_collector": 13, "rss_refiner": 3, "projection_sender": 3, "other": 0}, "currentRevisionRefinerUnknown": 2, "unknownBaselineAt": status.timestamp(now - timedelta(hours=1)), "existingUnknown": 19, "newUnknown": 0, "unresolvedOperations": {"count": 59, "oldestAt": succeeded, "oldestAgeMs": 46_500_000}, "unresolvedOutbox": {"count": 1, "oldestAt": succeeded, "oldestAgeMs": 46_500_000}, "terminalFailedOutbox": 6},
        "backupPoint": backup_point,
    }
    value["components"]["backup"].update({
        "status": "failed", "reasons": ["BACKUP_POINT_STALE"], "point": dict(backup_point),
        "manifestVerified": True, "offHostSignatureVerified": True, "applicationSignatureVerified": True,
        "offHostReadCompletedAt": succeeded, "applicationDrillCompletedAt": succeeded,
    })
    value["components"]["http"][0].update({"status": "healthy", "reasons": [], "statusCode": 200, "semantic": "public-real-snapshot"})
    value["components"]["http"][1].update({"status": "failed", "reasons": ["HTTP_NETWORK_ERROR"]})
    return status.validate_result(value, now)


class PagesTests(unittest.TestCase):
    def pages(self):
        value = sample()
        value["components"]["http"][1].update({"status": "healthy", "reasons": [], "statusCode": 200, "semantic": "public-static-snapshot", "targetKind": "github-pages", "staticSnapshot": {"bundleId": "a" * 64, "generatedAt": "2026-09-01T01:02:03.000Z", "schemaVersion": "public-read-v0.1", "visibleItems": 0, "syncFreshness": "unknown"}})
        return value

    def test_pages_success_preserves_business_failure_and_unknown_freshness(self):
        value = self.pages()
        value["components"]["processes"][2].update({"status": "failed", "reasons": ["PROCESS_NOT_RUNNING"], "state": "not_running", "pid": None, "startedAt": None})
        checked = status.validate_result(value)
        self.assertEqual(checked["status"], "failed")
        report = status.render_report(checked)
        for text in ("Pages（M1 视角）：正常", "首屏公开 DTO 可读；0 条", "https://1404369477-blip.github.io/f1plus1/", "Pages 同步新鲜度：未知", "本机公开站：失败", "隧道 失败", "2026-09-01 09:02:03.000 北京时间"):
            self.assertIn(text, report)
        self.assertNotIn("current.json", report)

    def test_pages_closed_shape_and_success_state_combinations(self):
        invalid = [
            {"targetKind": "elsewhere"}, {"probe": "local-public"}, {"staticSnapshot": None},
            {"semantic": "public-real-snapshot"}, {"statusCode": 503}, {"reasons": ["HTTP_STATIC_INVALID"]},
            {"privatePath": "/secret"},
        ]
        for changed in invalid:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                value = self.pages(); value["components"]["http"][1].update(changed); status.validate_result(value)
        for changed in ({"visibleItems": 13}, {"syncFreshness": "healthy"}, {"extra": "secret"}, {"schemaVersion": "wrong"}, {"generatedAt": "not-a-time"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                value = self.pages(); value["components"]["http"][1]["staticSnapshot"].update(changed); status.validate_result(value)

    def test_pages_failure_has_no_snapshot_and_retains_home_link(self):
        value = self.pages()
        value["components"]["http"][1].update({"status": "failed", "reasons": ["HTTP_STATIC_INVALID"], "semantic": None, "staticSnapshot": None})
        report = status.render_report(status.validate_result(value))
        self.assertIn("Pages（M1 视角）：失败", report)
        self.assertIn("网站入口：https://1404369477-blip.github.io/f1plus1/", report)
        self.assertIn("Pages 同步新鲜度：未知", report)
        value["components"]["http"][1]["reasons"] = ["PUBLIC_TARGET_IDENTITY_UNKNOWN"]
        with self.assertRaises(ValueError):
            status.validate_result(value)


class ReportTests(unittest.TestCase):
    def test_beijing_conversion_full_dates_and_expiry_cross_midnight(self):
        cases = {
            "2026-09-10T15:15:10.789Z": "2026-09-10 23:15:10.789 北京时间（UTC+8）",
            "2026-09-10T16:00:00.000Z": "2026-09-11 00:00:00.000 北京时间（UTC+8）",
            "2026-09-30T23:59:59.999Z": "2026-10-01 07:59:59.999 北京时间（UTC+8）",
            "2026-12-31T20:00:00.123Z": "2027-01-01 04:00:00.123 北京时间（UTC+8）",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(status.beijing_time(source), expected)
        now = datetime(2026, 9, 10, 15, 59, 30, 123000, tzinfo=timezone.utc)
        report = status.render_report(status.unknown_result("SAMPLER_TIMEOUT", now))
        self.assertIn("巡检时间：2026-09-10 23:59:30.123 北京时间（UTC+8）", report)
        self.assertIn("结果有效至：2026-09-11 00:00:30.123 北京时间（UTC+8）", report)

    def test_failed_report_formats_rss_backup_age_and_distinct_queue_counts(self):
        now = datetime(2026, 9, 10, 15, 15, 10, 789000, tzinfo=timezone.utc)
        value = complete_sample(now)
        report = status.render_report(value)
        self.assertIn("存在失败项（failed）", report)
        self.assertIn("巡检时间：2026-09-10 23:15:10.789 北京时间（UTC+8）", report)
        self.assertIn("最近成功 2026-09-10 10:20:10.789 北京时间（UTC+8）", report)
        self.assertIn("已登记恢复点 2026-09-10 10:15:10.789 北京时间（UTC+8）", report)
        self.assertIn("恢复点年龄约13小时0分0秒，时效上限15分0秒", report)
        self.assertIn("缺当前草稿 1，待审核 0，待发布 1", report)
        self.assertIn("结果未知操作 19（涵盖历史版本", report)
        self.assertIn("未决投递 1；历史失败投递 6", report)
        self.assertNotIn("未决投递 19", report)
        self.assertIn("清单校验通过；异机回执验签通过；应用演练回执验签通过", report)
        self.assertNotIn("2026-09-10T", report)

    def test_unknown_and_read_failures_are_not_reported_as_zero_or_site_failure(self):
        unavailable = status.render_report(status.unknown_result("SAMPLER_TIMEOUT"))
        self.assertIn("状态未知（unknown）", unavailable)
        self.assertIn("巡检采样超时", unavailable)
        self.assertIn("本次未判断站点是否故障", unavailable)
        partial = status.render_report(sample())
        self.assertIn("控制状态：未知；阶段、全局停止、应急停止、恢复、删除门、发布门均未知", partial)
        self.assertIn("RSS 与各信源队列：未知", partial)
        self.assertIn("队列数未获得", partial)
        self.assertIn("备份检查：未知；已登记恢复点未知", partial)
        self.assertIn("可用空间变化率：未知", partial)
        self.assertNotIn("未决投递 0", partial)
        self.assertNotIn("最近成功 0", partial)
        self.assertNotIn("恢复点年龄约0", partial)

    def test_control_stop_is_visible_when_it_is_the_only_failed_observation(self):
        now = datetime(2026, 9, 10, 14, 0, tzinfo=timezone.utc)
        value = complete_sample(now)
        parts = value["components"]
        db = parts["database"]
        db["reasons"] = ["CONTROL_CLOSED"]
        db["control"].update({"status": "failed", "globalStopState": "stopped"})
        db["rss"]["status"] = "healthy"
        empty = {"count": 0, "oldestAt": None, "oldestAgeMs": None}
        recent = status.timestamp(now - timedelta(minutes=5))
        previous = status.timestamp(now - timedelta(minutes=20))
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
        parts["storage"].update({"status": "healthy", "reasons": [], "growth": {"status": "observed", "availableBytesChangePerHour": 0, "baselineAt": status.timestamp(now - timedelta(minutes=1)), "baselineAvailableBytes": 500, "intervalMs": 60000, "scope": "in-memory-comparison"}})
        status.validate_result(value, now)
        report = status.render_report(value)
        control_line = next(line for line in report.splitlines() if line.startswith("控制状态："))
        for expected in ("失败（failed）", "阶段 live", "全局停止 stopped", "应急停止 clear", "恢复 ready", "删除门 clear", "发布门 clear", "操作来源与根因未查"):
            self.assertIn(expected, control_line)
        self.assertIn("RSS：正常", report)
        self.assertIn("备份检查：正常", report)
        self.assertEqual([line for line in report.splitlines() if "失败（failed）" in line], [control_line])
        self.assertNotIn("人为停止", report)

    def test_report_does_not_infer_job_liveness_or_human_worker_scheduler_causes(self):
        report = status.render_report(complete_sample())
        self.assertIn("公网（M1 视角）：失败（网络请求失败）", report)
        self.assertIn("loopback 边界拒绝已验证（HTTP 404）；私网登录可用性未知", report)
        self.assertIn("进程存在不代表业务处理正常", report)
        self.assertIn("采集任务、备份任务的存活状态未采样，异常根因未查", report)
        for forbidden in ("worker", "卡死", "备份任务没跑", "备份任务没有运行", "采集任务已经停止", "不是人为停止", "人为停止已排除", "调度故障", "业务一切正常"):
            self.assertNotIn(forbidden, report)

    def test_report_and_mcp_wrapper_preserve_original_structured_dto(self):
        value = complete_sample()
        before = json.dumps(value, sort_keys=True)
        result = status.formatted_result(value)
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent, value)
        self.assertEqual(json.dumps(value, sort_keys=True), before)
        self.assertEqual(len(result.content), 1)
        self.assertEqual(result.content[0].text, status.render_report(value))
        self.assertIn("北京时间（UTC+8）", result.content[0].text)

    def test_measured_capacity_interval_uses_beijing_and_does_not_attribute_f1_growth(self):
        now = datetime(2026, 9, 10, 16, 0, 0, tzinfo=timezone.utc)
        status.CAPACITY_BASELINE = None
        status.compare_capacity(sample(now - timedelta(minutes=1)))
        value = status.compare_capacity(sample(now, 400))
        report = status.render_report(value)
        self.assertIn("2026-09-10 23:59:00.000 北京时间（UTC+8） 至 2026-09-11 00:00:00.000 北京时间（UTC+8）", report)
        self.assertIn("-6000.00 字节/小时", report)
        self.assertIn("不归因为 F1 文件增长", report)
        status.CAPACITY_BASELINE = None


class OutputValidationTests(unittest.TestCase):
    def setUp(self):
        status.CAPACITY_BASELINE = None

    def test_real_failure_remains_failure_and_metrics_do_not_become_zero(self):
        value = status.validate_result(sample())
        self.assertEqual(value["status"], "failed")
        self.assertIsNone(value["components"]["database"]["pipeline"])

    def test_expired_future_and_extended_ttl_are_rejected(self):
        now = datetime.now(timezone.utc)
        with self.assertRaisesRegex(ValueError, "SAMPLE_EXPIRED"):
            status.validate_result(sample(now - timedelta(seconds=61)), now)
        with self.assertRaisesRegex(ValueError, "SAMPLE_CLOCK_INVALID"):
            status.validate_result(sample(now + timedelta(seconds=5)), now)
        value = sample(now)
        value["expiresAt"] = status.timestamp(now + timedelta(seconds=120))
        with self.assertRaisesRegex(ValueError, "SAMPLE_CLOCK_INVALID"):
            status.validate_result(value, now)

    def test_old_nested_sample_cannot_be_refreshed_by_new_envelope(self):
        value = sample()
        value["components"]["database"]["observedAt"] = "2020-01-01T00:00:00.000Z"
        with self.assertRaisesRegex(ValueError, "SAMPLE_CLOCK_INVALID"):
            status.validate_result(value)

    def test_extra_fields_and_arbitrary_strings_are_rejected_at_nested_boundary(self):
        for target, key, content in [("database", "path", "/private/config"), ("backup", "reasons", ["secret-token"]), ("storage", "availableBytes", float("nan")), ("storage", "filesystemRef", "/Users/private")]:
            with self.subTest(target=target, key=key):
                value = sample()
                value["components"][target][key] = content
                with self.assertRaises(ValueError):
                    status.validate_result(value)

    def test_partial_malformed_and_inconsistent_status_are_rejected(self):
        for value in [{"status": "healthy"}, {**sample(), "status": "healthy"}, {**sample(), "unexpected": 1}]:
            with self.assertRaises(ValueError):
                status.validate_result(value)
        value = sample()
        value["components"]["http"] = []
        with self.assertRaises(ValueError):
            status.validate_result(value)

    def test_rejects_duplicate_json_keys(self):
        with self.assertRaises(ValueError):
            json.loads('{"status":"failed","status":"healthy"}', object_pairs_hook=status.unique_object)

    def test_first_and_rapid_samples_remain_unknown_then_measure_free_space_change(self):
        now = datetime.now(timezone.utc)
        first = status.compare_capacity(status.validate_result(sample(now), now))
        self.assertEqual(first["components"]["storage"]["growth"]["status"], "unknown")
        early = status.compare_capacity(status.validate_result(sample(now + timedelta(seconds=30), 480), now + timedelta(seconds=30)))
        self.assertEqual(early["components"]["storage"]["growth"]["status"], "unknown")
        current_time = now + timedelta(seconds=60)
        second = status.compare_capacity(status.validate_result(sample(current_time, 400), current_time))
        self.assertEqual(second["components"]["storage"]["growth"], {"status": "observed", "availableBytesChangePerHour": -6000, "baselineAt": first["observedAt"], "baselineAvailableBytes": 500, "intervalMs": 60000, "scope": "in-memory-comparison"})
        status.validate_result(second, current_time)
        self.assertEqual(second["status"], "failed")

    def test_restart_filesystem_change_total_change_and_long_gap_reset_baseline(self):
        now = datetime.now(timezone.utc)
        for change in ("restart", "filesystem", "total", "stale"):
            with self.subTest(change=change):
                status.CAPACITY_BASELINE = None
                status.compare_capacity(sample(now))
                current_time = now + timedelta(seconds=1000 if change == "stale" else 60)
                value = sample(current_time, 400)
                if change == "restart":
                    status.CAPACITY_BASELINE = None
                elif change == "filesystem":
                    value["components"]["storage"]["filesystemRef"] = "b" * 64
                elif change == "total":
                    value["components"]["storage"]["totalBytes"] = 2000
                result = status.compare_capacity(value)
                self.assertEqual(result["components"]["storage"]["growth"]["status"], "unknown")


class FixedExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="f1-status-mcp-test-")
        self.child = Path(self.temp.name) / "sample.ts"
        self.old = status.NODE_PATH, status.CONFIG_PATH, status.SCRIPT_PATH, status.COMMAND_TIMEOUT_SECONDS
        status.NODE_PATH = str(NODE)
        status.CONFIG_PATH = str(Path(self.temp.name) / "fixed.json")
        status.SCRIPT_PATH = self.child
        status.CAPACITY_BASELINE = None
        status.COMMAND_LOCK = asyncio.Lock()

    async def asyncTearDown(self):
        status.NODE_PATH, status.CONFIG_PATH, status.SCRIPT_PATH, status.COMMAND_TIMEOUT_SECONDS = self.old
        self.temp.cleanup()

    def write_result(self, value):
        self.child.write_text("process.stderr.write('/private/secret-token');process.stdout.write(" + json.dumps(json.dumps(value)) + ");", encoding="utf-8")

    async def test_fixed_argv_clean_environment_stderr_suppression(self):
        self.write_result(sample())
        original = asyncio.create_subprocess_exec
        calls = []
        async def track(*args, **kwargs):
            calls.append((args, kwargs))
            return await original(*args, **kwargs)
        with patch.object(status.asyncio, "create_subprocess_exec", side_effect=track), patch.dict(os.environ, {"NODE_OPTIONS": "evil", "SECRET": "hidden"}):
            result = await status.execute_fixed()
        self.assertEqual(result["status"], "failed")
        args, kwargs = calls[0]
        self.assertEqual(args, (str(NODE), "--no-warnings", "--experimental-strip-types", str(self.child)))
        self.assertEqual(set(kwargs["env"]), {"PATH", "LANG", "LC_ALL", "F1_STATUS_CONFIG_PATH"})
        self.assertNotIn("shell", kwargs)
        self.assertEqual(kwargs["stderr"], asyncio.subprocess.DEVNULL)
        self.assertNotIn("secret", json.dumps(result))

    async def test_process_timeout_kills_only_launched_process_group(self):
        self.child.write_text("setInterval(() => {}, 1000);", encoding="utf-8")
        status.COMMAND_TIMEOUT_SECONDS = 0.1
        begin = time.monotonic()
        with patch.object(status.os, "killpg", wraps=os.killpg) as kill:
            result = await status.execute_fixed()
        self.assertEqual(result["reasons"], ["SAMPLER_TIMEOUT"])
        self.assertEqual(kill.call_count, 1)
        self.assertLess(time.monotonic() - begin, 1.5)

    async def test_stdout_limit_kills_overproducing_process(self):
        self.child.write_text("process.stdout.write('x'.repeat(200000));setInterval(() => {}, 1000);", encoding="utf-8")
        result = await status.execute_fixed()
        self.assertEqual(result["reasons"], ["SAMPLER_OUTPUT_LIMIT"])

    async def test_invalid_and_expired_child_outputs_are_sanitized(self):
        for value, expected in [("private secret path", "SAMPLER_OUTPUT_INVALID"), (sample(datetime.now(timezone.utc) - timedelta(seconds=61)), "SAMPLE_EXPIRED"), ({"status": "healthy", "path": "/private/secret"}, "SAMPLER_OUTPUT_INVALID")]:
            self.write_result(value)
            result = await status.execute_fixed()
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(result["reasons"], [expected])
            self.assertNotIn("private", json.dumps(result))

    async def test_exit_failure_is_fixed_unknown_and_invalid_launch_path_never_runs(self):
        self.child.write_text("process.stderr.write('/private/secret');process.exit(9);", encoding="utf-8")
        self.assertEqual((await status.execute_fixed())["reasons"], ["SAMPLER_FAILED"])
        status.NODE_PATH = "node"
        with patch.object(status.asyncio, "create_subprocess_exec", new_callable=AsyncMock) as launch:
            self.assertEqual((await status.execute_fixed())["reasons"], ["CONFIG_INVALID"])
            launch.assert_not_awaited()

    async def test_unknown_tool_and_arguments_never_invoke_sampler(self):
        with patch.object(status, "execute_fixed", new_callable=AsyncMock) as execute:
            for name, arguments in [("get_site_status", {"sql": "SELECT secret"}), ("get_site_status", {"path": "/private"}), ("get_site_status", {"url": "https://evil"}), ("get_site_status", {"action": "restart"}), ("unknown", {})]:
                result = await status.mcp.call_tool(name, arguments)
                self.assertTrue(result.isError)
                self.assertEqual(result.structuredContent["reasons"], ["ARGUMENTS_REJECTED"])
                self.assertIn("此工具仅接受空参数，未执行巡检", result.content[0].text)
                self.assertNotIn("SELECT secret", result.content[0].text)
            execute.assert_not_awaited()


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_declares_only_one_no_argument_readonly_tool(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        params = StdioServerParameters(command=sys.executable, args=["-B", str(SCRIPT)], env={"F1_STATUS_NODE_PATH": str(NODE), "F1_STATUS_CONFIG_PATH": "/missing/fixed-config.json", "PYTHONDONTWRITEBYTECODE": "1"})
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                self.assertIsNone(initialized.capabilities.resources)
                self.assertIsNone(initialized.capabilities.prompts)
                definitions = await session.list_tools()
                self.assertEqual([tool.name for tool in definitions.tools], ["get_site_status"])
                tool = definitions.tools[0]
                self.assertEqual(tool.inputSchema, {"type": "object", "properties": {}, "additionalProperties": False})
                self.assertTrue(tool.annotations.readOnlyHint)
                self.assertFalse(tool.annotations.destructiveHint)
                self.assertTrue(tool.annotations.idempotentHint)
                self.assertIn("直接使用 content 中给定的中文报告", tool.description)
                denied = await session.call_tool("get_site_status", {"sql": "SELECT private"})
                self.assertTrue(denied.isError)
                self.assertEqual(denied.structuredContent["reasons"], ["ARGUMENTS_REJECTED"])
                result = await session.call_tool("get_site_status", {})
                self.assertEqual(result.structuredContent["status"], "unknown")
                self.assertEqual(result.structuredContent["reasons"], ["CONFIG_INVALID"])
                self.assertIn("固定巡检配置不可用", result.content[0].text)
                self.assertIn("北京时间（UTC+8）", result.content[0].text)
                self.assertNotIn("/missing", json.dumps(result.model_dump()))

    async def test_real_stdio_delivers_failed_formatted_text_and_original_dto_together(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        value = complete_sample()
        # Only the fixed sample producer is replaced in this isolated test server; the real MCP handler and SDK serialize the result.
        with tempfile.TemporaryDirectory(prefix="f1-status-report-test-") as directory:
            launcher = Path(directory) / "server.py"
            launcher.write_text(
                "import importlib.util, json\n"
                f"spec = importlib.util.spec_from_file_location('status_mcp', {str(SCRIPT)!r})\n"
                "module = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\n"
                f"value = json.loads({json.dumps(value)!r})\n"
                "async def fixed_sample():\n    return value\n"
                "module.execute_fixed = fixed_sample\nmodule.mcp.run(transport='stdio')\n", encoding="utf-8",
            )
            params = StdioServerParameters(command=sys.executable, args=["-B", str(launcher)], env={"PYTHONDONTWRITEBYTECODE": "1"})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool("get_site_status", {})
                    self.assertFalse(result.isError)
                    self.assertEqual(result.structuredContent, value)
                    self.assertEqual(len(result.content), 1)
                    self.assertEqual(result.content[0].text, status.render_report(value))
                    self.assertIn("存在失败项（failed）", result.content[0].text)
                    self.assertIn("异常根因未查", result.content[0].text)


if __name__ == "__main__":
    unittest.main()
