#!/usr/bin/env python3
"""One fixed read-only tool. Startup environment is operator configuration, never tool input."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
import json
import math
import os
from pathlib import Path
import re
import signal
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent, ToolAnnotations

MAX_OUTPUT_BYTES = 131_072
COMMAND_TIMEOUT_SECONDS = 24
TTL_SECONDS = 60
SCRIPT_PATH = Path(__file__).resolve().with_name("site-status.ts")
NODE_PATH = os.environ.get("F1_STATUS_NODE_PATH", "")
CONFIG_PATH = os.environ.get("F1_STATUS_CONFIG_PATH", "")
COMMAND_LOCK = asyncio.Lock()
CAPACITY_BASELINE: dict[str, Any] | None = None

STATUSES = {"healthy", "degraded", "failed", "unknown"}
ENVELOPE_REASONS = set("CONFIG_INVALID RUNTIME_VERSION_INVALID ARGUMENTS_REJECTED SAMPLER_FAILED SAMPLER_TIMEOUT SAMPLER_OUTPUT_LIMIT SAMPLER_OUTPUT_INVALID SAMPLE_EXPIRED SAMPLE_CLOCK_INVALID".split())
RUNTIME_REASONS = set("HTTP_TIMEOUT HTTP_NETWORK_ERROR HTTP_REDIRECT_REJECTED HTTP_STATUS_UNEXPECTED HTTP_BODY_TOO_LARGE HTTP_HEALTH_INVALID HTTP_STATIC_INVALID PUBLIC_TARGET_IDENTITY_UNKNOWN PROCESS_NOT_LOADED PROCESS_NOT_RUNNING PROCESS_READ_FAILED PROCESS_TIMEOUT PROCESS_OUTPUT_INVALID STORAGE_READ_FAILED STORAGE_CAPACITY_INVALID STORAGE_LOW STORAGE_CRITICAL STORAGE_GROWTH_BASELINE_UNAVAILABLE".split())
DATABASE_REASONS = set("DATABASE_READ_FAILED DATABASE_IDENTITY_MISMATCH DATABASE_SCHEMA_MISMATCH DEPLOYMENT_IDENTITY_MISMATCH DATABASE_SAMPLE_LIMIT DATABASE_DATA_INVALID CLOCK_INVALID CONTROL_CLOSED RSS_SOURCE_DISABLED RSS_SUCCESS_UNKNOWN RSS_SUCCESS_STALE RSS_SLOT_INTERVAL_UNKNOWN RSS_SLOT_INTERVAL_EXCEEDED RSS_LATEST_ATTEMPT_FAILED RSS_DRAFT_BACKLOG_AGED RSS_REVIEW_BACKLOG_AGED RSS_PUBLICATION_BACKLOG_AGED UNKNOWN_OPERATIONS_PRESENT UNKNOWN_BASELINE_UNAVAILABLE UNRESOLVED_OPERATIONS_PRESENT UNRESOLVED_OUTBOX_PRESENT TERMINAL_FAILED_OUTBOX_PRESENT".split())
BACKUP_REASONS = set("BACKUP_DATABASE_UNKNOWN BACKUP_DATABASE_SAMPLE_STALE BACKUP_POINT_MISSING BACKUP_POINT_STALE BACKUP_TIME_INVALID BACKUP_EVIDENCE_MISSING BACKUP_EVIDENCE_INVALID BACKUP_MANIFEST_MISMATCH BACKUP_KEY_MISMATCH BACKUP_OFFHOST_SIGNATURE_INVALID BACKUP_APPLICATION_SIGNATURE_INVALID BACKUP_RECEIPT_BINDING_MISMATCH".split())
SERVICE_LABELS = ["com.f1plus1.public-beta", "com.f1plus1.admin-service", "com.f1plus1.quick-tunnel"]
SOURCE_IDS = {"motorsport-f1-news", "the-race-f1-news", "skysports-f1-news"}


def timestamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def unknown_result(reason: str, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    return {
        "schemaVersion": 1, "status": "unknown", "observedAt": timestamp(now),
        "expiresAt": timestamp(now + timedelta(seconds=TTL_SECONDS)), "reasons": [reason],
        "sampling": "separate-readonly-samples", "vantage": "runtime-host",
        "components": {"database": None, "backup": None, "http": None, "processes": None, "storage": None},
    }


BEIJING = timezone(timedelta(hours=8))
STATUS_LABELS = {"healthy": "正常", "degraded": "需关注", "failed": "失败", "unknown": "未知"}
SOURCE_LABELS = {"motorsport-f1-news": "Motorsport", "the-race-f1-news": "The Race", "skysports-f1-news": "Sky Sports"}
REASON_LABELS = {
    "CONFIG_INVALID": "固定巡检配置不可用", "RUNTIME_VERSION_INVALID": "巡检运行时版本不符",
    "ARGUMENTS_REJECTED": "调用已拒绝，此工具仅接受空参数，未执行巡检",
    "SAMPLER_FAILED": "巡检采样未完成", "SAMPLER_TIMEOUT": "巡检采样超时",
    "SAMPLER_OUTPUT_LIMIT": "巡检结果超过大小限制", "SAMPLER_OUTPUT_INVALID": "巡检结果未通过格式校验",
    "SAMPLE_EXPIRED": "巡检观测已过期", "SAMPLE_CLOCK_INVALID": "巡检观测时间无效",
    "HTTP_TIMEOUT": "HTTP 请求超时", "HTTP_NETWORK_ERROR": "网络请求失败",
    "HTTP_REDIRECT_REJECTED": "响应重定向已被拒绝", "HTTP_STATUS_UNEXPECTED": "HTTP 状态不符合预期",
    "HTTP_BODY_TOO_LARGE": "响应超过大小限制", "HTTP_HEALTH_INVALID": "响应未通过语义校验",
    "HTTP_STATIC_INVALID": "Pages 公开快照身份或正文校验失败",
    "PUBLIC_TARGET_IDENTITY_UNKNOWN": "当前隧道身份无法确认，本轮未请求该固定公网地址",
    "PROCESS_NOT_LOADED": "未观测到已加载服务", "PROCESS_NOT_RUNNING": "采样时服务未运行",
    "PROCESS_READ_FAILED": "进程信息读取失败", "PROCESS_TIMEOUT": "进程信息读取超时",
    "PROCESS_OUTPUT_INVALID": "进程信息未通过校验", "STORAGE_READ_FAILED": "容量读取失败",
    "STORAGE_CAPACITY_INVALID": "容量数据无效", "STORAGE_LOW": "可用空间低于提醒阈值",
    "STORAGE_CRITICAL": "可用空间低于失败阈值", "STORAGE_GROWTH_BASELINE_UNAVAILABLE": "缺少可靠的两次容量采样",
    "DATABASE_READ_FAILED": "数据库只读采样失败", "DATABASE_IDENTITY_MISMATCH": "数据库身份不符",
    "DATABASE_SCHEMA_MISMATCH": "数据库结构身份不符", "DEPLOYMENT_IDENTITY_MISMATCH": "部署身份不符",
    "DATABASE_SAMPLE_LIMIT": "数据库采样超出限制", "DATABASE_DATA_INVALID": "数据库观测数据无效",
    "CLOCK_INVALID": "数据时间无效", "CONTROL_CLOSED": "控制条件未满足",
    "RSS_SOURCE_DISABLED": "信源启用或停止门未通过", "RSS_SUCCESS_UNKNOWN": "最近成功时间未知",
    "RSS_SUCCESS_STALE": "成功记录超龄", "RSS_SLOT_INTERVAL_UNKNOWN": "实际成功间隔未知",
    "RSS_SLOT_INTERVAL_EXCEEDED": "实际成功间隔超限", "RSS_LATEST_ATTEMPT_FAILED": "最近记录的尝试未成功",
    "RSS_DRAFT_BACKLOG_AGED": "缺当前草稿的等待时间超限", "RSS_REVIEW_BACKLOG_AGED": "待审核等待时间超限",
    "RSS_PUBLICATION_BACKLOG_AGED": "待发布等待时间超限", "UNKNOWN_OPERATIONS_PRESENT": "存在结果未知的操作",
    "UNKNOWN_BASELINE_UNAVAILABLE": "未知操作缺少可比基线", "UNRESOLVED_OPERATIONS_PRESENT": "存在未决操作",
    "UNRESOLVED_OUTBOX_PRESENT": "存在未决投递", "TERMINAL_FAILED_OUTBOX_PRESENT": "存在历史失败投递",
    "BACKUP_DATABASE_UNKNOWN": "备份所需数据库观测不可用", "BACKUP_DATABASE_SAMPLE_STALE": "备份所用数据库观测已过期",
    "BACKUP_POINT_MISSING": "未检出匹配当前身份的已登记恢复点", "BACKUP_POINT_STALE": "恢复点超过时效上限",
    "BACKUP_TIME_INVALID": "恢复点时间无效", "BACKUP_EVIDENCE_MISSING": "备份验证证据缺失",
    "BACKUP_EVIDENCE_INVALID": "备份验证证据无效", "BACKUP_MANIFEST_MISMATCH": "备份清单不匹配",
    "BACKUP_KEY_MISMATCH": "备份验签公钥身份不符", "BACKUP_OFFHOST_SIGNATURE_INVALID": "异机回执验签失败",
    "BACKUP_APPLICATION_SIGNATURE_INVALID": "应用演练回执验签失败", "BACKUP_RECEIPT_BINDING_MISMATCH": "备份回执绑定不匹配",
}


def beijing_time(value: str | None) -> str:
    if value is None:
        return "未知"
    local = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(BEIJING)
    return f"{local:%Y-%m-%d %H:%M:%S}.{local.microsecond // 1000:03d} 北京时间（UTC+8）"


def elapsed_time(milliseconds: int | float | None) -> str:
    if milliseconds is None:
        return "未知"
    seconds = int(milliseconds // 1000)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    if hours:
        return f"{hours}小时{minutes}分{seconds}秒"
    if minutes:
        return f"{minutes}分{seconds}秒"
    return f"{seconds}秒"


def readable_bytes(value: int | None) -> str:
    if value is None:
        return "未知"
    return f"{value / (1024 ** 3):.2f} GiB" if value >= 1024 ** 3 else f"{value} 字节"


def reason_text(reasons: list[str]) -> str:
    return "、".join(REASON_LABELS[reason] for reason in dict.fromkeys(reasons))


def check_text(value: bool | None) -> str:
    return "通过" if value is True else "未通过" if value is False else "未知"


def render_report(value: dict[str, Any]) -> str:
    """Format a validated DTO without changing it or inferring a job state / failure cause."""
    overall = {"healthy": "已验证检查项正常", "degraded": "存在需关注项", "failed": "存在失败项", "unknown": "状态未知"}[value["status"]]
    lines = [
        f"F1+1 巡检：{overall}（{value['status']}）。",
        f"巡检时间：{beijing_time(value['observedAt'])}。",
        f"结果有效至：{beijing_time(value['expiresAt'])}；仅对应本次观测。",
    ]
    parts = value["components"]
    if parts["database"] is None:
        lines.append(f"巡检结果不可用：{reason_text(value['reasons'])}。")
        lines.append("网站、RSS、处理队列、备份、容量与 Admin 登录可用性：未知；未取得可用的分项观测。")
        lines.append("本次未判断站点是否故障，异常根因未查。")
        return "\n".join(lines)

    probes = {item["probe"]: item for item in parts["http"]}
    for probe_id, label in (("local-public", "本机公开站"), ("public-https", "公网（M1 视角）")):
        item = probes[probe_id]
        is_pages = item.get("targetKind") == "github-pages"
        if is_pages:
            label = "Pages（M1 视角）"
        details = []
        if item["statusCode"] is not None:
            details.append(f"HTTP {item['statusCode']}")
        if item["semantic"] == "public-real-snapshot":
            details.append("真实公开快照检查通过")
        if item["semantic"] == "public-static-snapshot":
            details.append(f"首屏公开 DTO 可读；{item['staticSnapshot']['visibleItems']} 条")
        if item["reasons"]:
            details.append(reason_text(item["reasons"]))
        lines.append(f"{label}：{STATUS_LABELS[item['status']]}（{'；'.join(details) or '未取得可用观测'}）。")
        if is_pages:
            lines.append("网站入口：https://1404369477-blip.github.io/f1plus1/")
            if item["staticSnapshot"] is not None:
                lines.append(f"Pages 导出时间：{beijing_time(item['staticSnapshot']['generatedAt'])}。")
            lines.append("Pages 同步新鲜度：未知；本轮未与 M1 当前公开投影对账。Pages 可读不代表 M1 业务或同步正常。")

    db = parts["database"]
    control_sample = db["control"]
    if control_sample is None:
        lines.append("控制状态：未知；阶段、全局停止、应急停止、恢复、删除门、发布门均未知。")
    else:
        lines.append(f"控制状态：{STATUS_LABELS[control_sample['status']]}（{control_sample['status']}）；阶段 {control_sample['phase']}，全局停止 {control_sample['globalStopState']}，应急停止 {control_sample['emergencyStopState']}，恢复 {control_sample['recoveryState']}，删除门 {control_sample['deletionFenceState']}，发布门 {control_sample['publicationFenceState']}。仅显示当前值，操作来源与根因未查。")
    if db["rss"] is None:
        lines.append(f"RSS 与各信源队列：未知（{reason_text(db['reasons']) or '数据库观测不可用'}）；队列数未获得。")
    else:
        rss = db["rss"]
        lines.append(f"RSS：{STATUS_LABELS[rss['status']]}；最近成功记录与当前队列如下。")
        sources = {item["sourceId"]: item for item in rss["sources"]}
        for source_id, label in SOURCE_LABELS.items():
            item = sources[source_id]
            age = f"；距采样约{elapsed_time(item['lastSuccessAgeMs'])}" if item["lastSuccessAgeMs"] is not None else ""
            lines.append(f"{label}：{STATUS_LABELS[item['status']]}；最近成功 {beijing_time(item['lastSuccessAt'])}{age}；缺当前草稿 {item['missingCurrentDraft']['count']}，待审核 {item['awaitingReview']['count']}，待发布 {item['queuedPublications']['count']}。")
        rss_reasons = [reason for item in rss["sources"] for reason in item["reasons"]]
        if rss_reasons:
            lines.append(f"RSS 原因：{reason_text(rss_reasons)}。")

    pipeline = db["pipeline"]
    if pipeline is None:
        lines.append("未决操作与投递队列：未知；计数未获得。")
    else:
        lines.append(f"处理队列：{STATUS_LABELS[pipeline['status']]}；未决操作 {pipeline['unresolvedOperations']['count']}；结果未知操作 {pipeline['unknownOperations']}（涵盖历史版本，其中当前版本整理请求未知 {pipeline['currentRevisionRefinerUnknown']}）；未决投递 {pipeline['unresolvedOutbox']['count']}；历史失败投递 {pipeline['terminalFailedOutbox']}。")
        if pipeline["unknownBaselineAt"] is not None and pipeline["newUnknown"] is not None and pipeline["existingUnknown"] is not None:
            lines.append(f"未知操作相对 {beijing_time(pipeline['unknownBaselineAt'])} 的基线：新增 {pipeline['newUnknown']}，已有 {pipeline['existingUnknown']}。")
        else:
            lines.append("新增未知操作数：未知，缺少可比基线。")

    backup_sample = parts["backup"]
    backup_point = backup_sample["point"]
    point_text = "已登记恢复点未知" if backup_point is None else f"已登记恢复点 {beijing_time(backup_point['recoveryPointAt'])}；恢复点年龄约{elapsed_time(backup_point['ageMs'])}，时效上限{elapsed_time(backup_sample['maxRecoveryPointAgeMs'])}"
    backup_reason = f"；{reason_text(backup_sample['reasons'])}" if backup_sample["reasons"] else ""
    lines.append(f"备份检查：{STATUS_LABELS[backup_sample['status']]}；{point_text}{backup_reason}。")
    lines.append(f"备份证据：清单校验{check_text(backup_sample['manifestVerified'])}；异机回执验签{check_text(backup_sample['offHostSignatureVerified'])}；应用演练回执验签{check_text(backup_sample['applicationSignatureVerified'])}。本次未重读完整异机密文或执行恢复。")

    capacity = parts["storage"]
    lines.append(f"磁盘容量：{STATUS_LABELS[capacity['capacityStatus']]}；可用 {readable_bytes(capacity['availableBytes'])}／总量 {readable_bytes(capacity['totalBytes'])}。")
    growth = capacity["growth"]
    if growth["status"] == "unknown":
        lines.append("可用空间变化率：未知，缺少可靠的两次容量采样。")
    else:
        lines.append(f"可用空间变化：{beijing_time(growth['baselineAt'])} 至 {beijing_time(capacity['observedAt'])}，间隔{elapsed_time(growth['intervalMs'])}；按此区间折算 {growth['availableBytesChangePerHour']:+.2f} 字节/小时。正值表示可用空间增加，负值表示减少，不归因为 F1 文件增长。")

    admin = probes["admin-auth"]
    if admin["status"] == "healthy":
        boundary = "loopback 边界拒绝已验证" if admin["semantic"] == "loopback-perimeter-rejection" else "未认证请求拒绝已验证"
        lines.append(f"Admin：{boundary}（HTTP {admin['statusCode']}）；私网登录可用性未知。")
    else:
        lines.append(f"Admin 边界检查：{STATUS_LABELS[admin['status']]}（{reason_text(admin['reasons']) or '未取得可用观测'}）；私网登录可用性未知。")
    service_names = dict(zip(SERVICE_LABELS, ("Public", "Admin", "隧道")))
    services = []
    for service in parts["processes"]:
        observed = "运行" if service["status"] == "healthy" else STATUS_LABELS[service["status"]] + "（" + reason_text(service["reasons"]) + "）"
        services.append(f"{service_names[service['service']]} {observed}")
    lines.append("服务进程（采样时）：" + "；".join(services) + "。进程存在不代表业务处理正常。")
    lines.append("采集任务、备份任务的存活状态未采样，异常根因未查。")
    return "\n".join(lines)


def formatted_result(value: dict[str, Any], *, is_error: bool = False) -> CallToolResult:
    return CallToolResult(isError=is_error, structuredContent=value, content=[TextContent(type="text", text=render_report(value))])


def fail() -> None:
    raise ValueError("SAMPLER_OUTPUT_INVALID")


def integer(value: Any) -> None:
    if type(value) is not int or value < 0 or value > 9_007_199_254_740_991:
        fail()


def boolean(value: Any) -> None:
    if type(value) is not bool:
        fail()


def number(value: Any) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or value > 9_007_199_254_740_991:
        fail()


def hashed(value: Any) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        fail()


def iso(value: Any) -> None:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value) is None:
        fail()
    datetime.fromisoformat(value.replace("Z", "+00:00"))


def enum(*values: Any):
    def check(value: Any) -> None:
        if not any(type(value) is type(item) and value == item for item in values):
            fail()
    return check


def nullable(check):
    def validate(value: Any) -> None:
        if value is not None:
            check(value)
    return validate


def array(check, maximum: int = 64):
    def validate(value: Any) -> None:
        if not isinstance(value, list) or len(value) > maximum:
            fail()
        for item in value:
            check(item)
    return validate


def obj(fields: dict[str, Any]):
    def validate(value: Any) -> None:
        if not isinstance(value, dict) or set(value) != set(fields):
            fail()
        for key, check in fields.items():
            check(value[key])
    return validate


status = enum(*STATUSES)
count_age = obj({"count": integer, "oldestAt": nullable(iso), "oldestAgeMs": nullable(number)})
point_fields = {
    "packageRef": hashed, "recoveryPointAt": iso, "completedAt": iso, "ageMs": number,
    "manifestSha256": hashed, "databaseSnapshotSha256": hashed, "deploymentManifestSha256": hashed,
    "releaseSha256": hashed, "schemaSha256": hashed, "writerEpoch": integer, "recoveryEpoch": integer,
    "writerAuthorityReceiptSha256": hashed, "projectionGeneration": integer, "projectionManifestSha256": nullable(hashed),
}
point = obj(point_fields)
source = obj({
    "sourceId": enum(*SOURCE_IDS), "status": status, "observedAt": iso, "reasons": array(enum(*DATABASE_REASONS)),
    "enabled": boolean, "lastAttemptAt": nullable(iso), "lastSuccessAt": nullable(iso), "lastSuccessAgeMs": nullable(number),
    "latestAttemptStatus": enum("running", "succeeded", "not_modified", "failed", "scheduler_gap", None),
    "latestSucceededSlotAt": nullable(iso), "previousSucceededSlotAt": nullable(iso), "actualSucceededSlotIntervalMs": nullable(number),
    "latestSucceededScheduledAt": nullable(iso), "previousSucceededScheduledAt": nullable(iso), "scheduledSucceededSlotIntervalMs": nullable(number),
    "candidateCounts": obj({key: integer for key in ("pending_review", "approved", "published", "rejected", "other")}),
    "backlog": count_age, "missingCurrentDraft": count_age, "awaitingReview": count_age, "queuedPublications": count_age,
})
control = obj({
    "status": status, "observedAt": iso, "phase": enum("disabled", "backlog", "live", "paused"),
    "globalStopState": enum("clear", "stopped"), "emergencyStopState": enum("clear", "stopped"),
    "recoveryState": enum("ready", "fenced", "restoring", "verifying", "failed"),
    "deletionFenceState": enum("clear", "blocked", "unknown"), "publicationFenceState": enum("clear", "blocked", "unknown"),
    **{key: integer for key in ("writerEpoch", "recoveryEpoch", "sourceConfigEpoch", "sourceSafetyEpoch", "authorizationVersion", "policyEpoch")},
    "writerAuthorityReceiptSha256": hashed,
})
database = obj({
    "status": status, "observedAt": iso, "reasons": array(enum(*DATABASE_REASONS)),
    "identity": nullable(obj({"deploymentManifestSha256": hashed, "schemaSha256": hashed, "releaseSha256": hashed, "userVersion": integer})),
    "control": nullable(control),
    "rss": nullable(obj({"status": status, "observedAt": iso, "cutoffAt": enum("2026-09-05T02:30:00.000Z"), "expectedSlotIntervalMs": enum(900000), "staleSuccessAfterMs": enum(900000), "failedSuccessAfterMs": enum(1800000), "sources": array(source, 3)})),
    "pipeline": nullable(obj({"status": status, "observedAt": iso, "unknownOperations": integer,
        "unknownScope": enum("recorded_unresolved_operations_all_revisions"),
        "unknownByOwner": obj({key: integer for key in ("rss_collector", "rss_refiner", "projection_sender", "other")}),
        "currentRevisionRefinerUnknown": integer,
        "unknownBaselineAt": nullable(iso), "existingUnknown": nullable(integer), "newUnknown": nullable(integer), "unresolvedOperations": count_age, "unresolvedOutbox": count_age, "terminalFailedOutbox": integer})),
    "backupPoint": nullable(point),
})
backup = obj({
    "status": status, "observedAt": iso, "reasons": array(enum(*BACKUP_REASONS)), "databaseObservedAt": iso, "point": nullable(point),
    "maxRecoveryPointAgeMs": enum(900000), "manifestVerified": nullable(boolean), "offHostSignatureVerified": nullable(boolean),
    "applicationSignatureVerified": nullable(boolean), "offHostReadCompletedAt": nullable(iso), "applicationDrillCompletedAt": nullable(iso),
    "verificationScope": enum("registered-point-and-pinned-signed-receipts"), "offHostCiphertextReread": enum(False), "restoreExecuted": enum(False),
})
http_fields = {
    "status": status, "observedAt": iso, "reasons": array(enum(*RUNTIME_REASONS)),
    "probe": enum("local-public", "public-https", "admin-auth"), "statusCode": nullable(integer), "durationMs": number,
    "semantic": enum("public-real-snapshot", "authentication-required", "loopback-perimeter-rejection", None),
    "authenticatedPrivateAccess": enum("unknown", "not-applicable"),
}
legacy_http = obj(http_fields)
pages_http = obj({
    **http_fields, "probe": enum("public-https"), "targetKind": enum("github-pages"),
    "semantic": enum("public-static-snapshot", None),
    "staticSnapshot": nullable(obj({"bundleId": hashed, "generatedAt": iso, "schemaVersion": enum("public-read-v0.1", "public-read-bilingual-v2"), "visibleItems": integer, "syncFreshness": enum("unknown")})),
})


def http(value: Any) -> None:
    if isinstance(value, dict) and "targetKind" in value:
        pages_http(value)
        snapshot = value["staticSnapshot"]
        if value["status"] == "healthy":
            if snapshot is None or snapshot["visibleItems"] > 12 or value["semantic"] != "public-static-snapshot":
                fail()
        elif value["status"] != "failed" or snapshot is not None or value["semantic"] is not None or len(value["reasons"]) != 1 or value["reasons"][0] not in {"HTTP_TIMEOUT", "HTTP_NETWORK_ERROR", "HTTP_REDIRECT_REJECTED", "HTTP_STATUS_UNEXPECTED", "HTTP_BODY_TOO_LARGE", "HTTP_STATIC_INVALID"}:
            fail()
    else:
        legacy_http(value)


def process_start(value: Any) -> None:
    if not isinstance(value, str) or re.fullmatch(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) \d{2}:\d{2}:\d{2} 20\d{2}", value) is None:
        fail()


process = obj({
    "status": status, "observedAt": iso, "reasons": array(enum(*RUNTIME_REASONS)), "service": enum(*SERVICE_LABELS),
    "state": enum("running", "not_running", None), "pid": nullable(integer), "startedAt": nullable(process_start),
})
def signed_number(value: Any) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 9_007_199_254_740_991:
        fail()


storage = obj({
    "status": status, "observedAt": iso, "reasons": array(enum(*RUNTIME_REASONS)), "capacityStatus": status,
    "availableBytes": nullable(integer), "totalBytes": nullable(integer), "filesystemRef": nullable(hashed), "warningAvailableBytes": integer, "failedAvailableBytes": integer,
    "growth": obj({"status": enum("unknown", "observed"), "availableBytesChangePerHour": nullable(signed_number), "baselineAt": nullable(iso), "baselineAvailableBytes": nullable(integer), "intervalMs": nullable(integer), "scope": enum("single-sample", "in-memory-comparison")}),
})
envelope = obj({
    "schemaVersion": enum(1), "status": status, "observedAt": iso, "expiresAt": iso,
    "reasons": array(enum(*ENVELOPE_REASONS)), "sampling": enum("separate-readonly-samples"), "vantage": enum("runtime-host"),
    "components": obj({"database": nullable(database), "backup": nullable(backup), "http": nullable(array(http, 3)), "processes": nullable(array(process, 3)), "storage": nullable(storage)}),
})


def combine_status(values: list[str]) -> str:
    return next((item for item in ("failed", "degraded", "unknown") if item in values), "healthy" if values else "unknown")


def validate_result(value: Any, now: datetime | None = None) -> dict[str, Any]:
    """Strict finite schema: no arbitrary message, path, account, response body or error string can pass."""
    envelope(value)
    now = now or datetime.now(timezone.utc)
    observed = datetime.fromisoformat(value["observedAt"].replace("Z", "+00:00"))
    expires = datetime.fromisoformat(value["expiresAt"].replace("Z", "+00:00"))
    if observed > now + timedelta(seconds=1) or expires != observed + timedelta(seconds=TTL_SECONDS):
        raise ValueError("SAMPLE_CLOCK_INVALID")
    if observed <= now - timedelta(seconds=TTL_SECONDS) or expires <= now:
        raise ValueError("SAMPLE_EXPIRED")
    observations: list[datetime] = []

    def inspect(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key == "observedAt":
                    sampled = datetime.fromisoformat(child.replace("Z", "+00:00"))
                    if sampled < observed or sampled > now + timedelta(seconds=1):
                        raise ValueError("SAMPLE_CLOCK_INVALID")
                    observations.append(sampled)
                elif isinstance(child, (dict, list)):
                    inspect(child)
        elif isinstance(item, list):
            for child in item:
                inspect(child)
    inspect(value["components"])
    parts = value["components"]
    if any(item is None for item in parts.values()):
        if not all(item is None for item in parts.values()) or value["status"] != "unknown" or len(value["reasons"]) != 1:
            fail()
        return value
    if value["reasons"] or not observations or min(observations) != observed:
        fail()
    if [item["probe"] for item in parts["http"]] != ["local-public", "public-https", "admin-auth"] or [item["service"] for item in parts["processes"]] != SERVICE_LABELS:
        fail()
    db = parts["database"]
    if db["rss"] is not None:
        if {item["sourceId"] for item in db["rss"]["sources"]} != SOURCE_IDS:
            fail()
    if any(db[key] is None for key in ("identity", "control", "rss", "pipeline")) and db["status"] == "healthy":
        fail()
    nested = [db[key]["status"] for key in ("control", "rss", "pipeline") if db[key] is not None]
    if nested and db["status"] != combine_status(nested):
        fail()
    if db["rss"] is not None and db["rss"]["status"] != combine_status([item["status"] for item in db["rss"]["sources"]]):
        fail()
    for probe in parts["http"]:
        expected_private = "unknown" if probe["probe"] == "admin-auth" else "not-applicable"
        if probe["authenticatedPrivateAccess"] != expected_private or probe["statusCode"] is not None and not 100 <= probe["statusCode"] <= 599:
            fail()
        if probe["status"] == "healthy":
            expected = (probe["statusCode"], probe["semantic"])
            public_semantic = "public-static-snapshot" if probe.get("targetKind") == "github-pages" else "public-real-snapshot"
            if probe["reasons"] or (expected not in {(404, "loopback-perimeter-rejection"), (401, "authentication-required")} if probe["probe"] == "admin-auth" else expected != (200, public_semantic)):
                fail()
    for service in parts["processes"]:
        if service["status"] == "healthy" and (service["state"] != "running" or not service["pid"] or service["startedAt"] is None or service["reasons"]):
            fail()
    point_sample = parts["backup"]
    if point_sample["status"] == "healthy" and (point_sample["point"] is None or point_sample["point"]["ageMs"] > point_sample["maxRecoveryPointAgeMs"] or not all(point_sample[key] is True for key in ("manifestVerified", "offHostSignatureVerified", "applicationSignatureVerified"))):
        fail()
    if parts["backup"]["databaseObservedAt"] != db["observedAt"]:
        fail()
    components = [parts["database"], parts["backup"], *parts["http"], *parts["processes"], parts["storage"]]
    if value["status"] != combine_status([item["status"] for item in components]):
        fail()
    capacity = parts["storage"]
    if not 0 < capacity["failedAvailableBytes"] < capacity["warningAvailableBytes"]:
        fail()
    if any(capacity[key] is None for key in ("availableBytes", "totalBytes", "filesystemRef")):
        if capacity["capacityStatus"] != "unknown" or not all(capacity[key] is None for key in ("availableBytes", "totalBytes", "filesystemRef")):
            fail()
    else:
        if not 0 <= capacity["availableBytes"] <= capacity["totalBytes"] or not capacity["totalBytes"]:
            fail()
        expected_capacity = "failed" if capacity["availableBytes"] < capacity["failedAvailableBytes"] else "degraded" if capacity["availableBytes"] < capacity["warningAvailableBytes"] else "healthy"
        if capacity["capacityStatus"] != expected_capacity:
            fail()
    growth = capacity["growth"]
    if growth["status"] == "unknown":
        if growth != {"status": "unknown", "availableBytesChangePerHour": None, "baselineAt": None, "baselineAvailableBytes": None, "intervalMs": None, "scope": "single-sample"}:
            fail()
    else:
        if growth["scope"] != "in-memory-comparison" or any(growth[key] is None for key in ("baselineAt", "baselineAvailableBytes", "intervalMs", "availableBytesChangePerHour")) or capacity["availableBytes"] is None:
            fail()
        delta = datetime.fromisoformat(capacity["observedAt"].replace("Z", "+00:00")) - datetime.fromisoformat(growth["baselineAt"].replace("Z", "+00:00"))
        if not 60_000 <= growth["intervalMs"] <= 900_000 or round(delta.total_seconds() * 1000) != growth["intervalMs"]:
            fail()
        expected = (capacity["availableBytes"] - growth["baselineAvailableBytes"]) * 3_600_000 / growth["intervalMs"]
        if not math.isclose(growth["availableBytesChangePerHour"], expected):
            fail()
    expected_status = capacity["capacityStatus"] if growth["status"] == "observed" else combine_status([capacity["capacityStatus"], "unknown"])
    if capacity["status"] != expected_status:
        fail()
    return value


def compare_capacity(value: dict[str, Any]) -> dict[str, Any]:
    """Keep one observation in this MCP process only; report whole-filesystem free-space change, never F1 growth attribution."""
    global CAPACITY_BASELINE
    current = value["components"]["storage"]
    if current is None or current["availableBytes"] is None or current["totalBytes"] is None or current["filesystemRef"] is None:
        CAPACITY_BASELINE = None
        return value
    current_time = datetime.fromisoformat(current["observedAt"].replace("Z", "+00:00"))
    baseline = CAPACITY_BASELINE
    next_baseline = {key: current[key] for key in ("availableBytes", "totalBytes", "filesystemRef", "observedAt")}
    if baseline is None or baseline["filesystemRef"] != current["filesystemRef"] or baseline["totalBytes"] != current["totalBytes"]:
        CAPACITY_BASELINE = next_baseline
        return value
    interval = round((current_time - datetime.fromisoformat(baseline["observedAt"].replace("Z", "+00:00"))).total_seconds() * 1000)
    if interval < 0 or interval > 900_000:
        CAPACITY_BASELINE = next_baseline
        return value
    if interval < 60_000:
        return value
    current["growth"] = {
        "status": "observed", "availableBytesChangePerHour": (current["availableBytes"] - baseline["availableBytes"]) * 3_600_000 / interval,
        "baselineAt": baseline["observedAt"], "baselineAvailableBytes": baseline["availableBytes"], "intervalMs": interval, "scope": "in-memory-comparison",
    }
    current["status"] = current["capacityStatus"]
    current["reasons"] = [reason for reason in current["reasons"] if reason != "STORAGE_GROWTH_BASELINE_UNAVAILABLE"]
    parts = value["components"]
    value["status"] = combine_status([parts["database"]["status"], parts["backup"]["status"], *[item["status"] for item in parts["http"]], *[item["status"] for item in parts["processes"]], current["status"]])
    CAPACITY_BASELINE = next_baseline
    return value


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail()
        result[key] = value
    return result


class OutputLimitError(Exception):
    pass


async def bounded_stdout(stream: asyncio.StreamReader) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await stream.read(8192)
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > MAX_OUTPUT_BYTES:
            raise OutputLimitError()
        chunks.append(chunk)


def valid_launch_path(value: str) -> bool:
    return bool(value) and Path(value).is_absolute() and str(Path(value)) == value and ".." not in Path(value).parts and not any(ord(char) < 32 or ord(char) == 127 for char in value)


async def execute_fixed() -> dict[str, Any]:
    if not valid_launch_path(NODE_PATH) or not valid_launch_path(CONFIG_PATH):
        return unknown_result("CONFIG_INVALID")
    child: asyncio.subprocess.Process | None = None
    try:
        async def run() -> dict[str, Any]:
            nonlocal child
            async with COMMAND_LOCK:
                child = await asyncio.create_subprocess_exec(
                    NODE_PATH, "--no-warnings", "--experimental-strip-types", str(SCRIPT_PATH),
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                    cwd=str(SCRIPT_PATH.parent), start_new_session=True,
                    env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "LC_ALL": "C", "F1_STATUS_CONFIG_PATH": CONFIG_PATH},
                )
                raw = await bounded_stdout(child.stdout)
                if await child.wait() != 0:
                    return unknown_result("SAMPLER_FAILED")
                value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=lambda _: fail())
                return validate_result(compare_capacity(validate_result(value)))
        return await asyncio.wait_for(run(), timeout=COMMAND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return unknown_result("SAMPLER_TIMEOUT")
    except OutputLimitError:
        return unknown_result("SAMPLER_OUTPUT_LIMIT")
    except ValueError as error:
        reason = str(error)
        return unknown_result(reason if reason in {"SAMPLE_EXPIRED", "SAMPLE_CLOCK_INVALID"} else "SAMPLER_OUTPUT_INVALID")
    except Exception:
        return unknown_result("SAMPLER_FAILED")
    finally:
        if child is not None and child.returncode is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(child.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass


class FixedStatusMCP(FastMCP):
    def _setup_handlers(self) -> None:
        # Tools only: resources/prompts handlers are absent and therefore never advertised.
        # Explicit argument validation below avoids SDK extra-field coercion and error text echoing input.
        self._mcp_server.list_tools()(self.list_tools)
        self._mcp_server.call_tool(validate_input=False)(self.call_tool)

    async def list_tools(self):
        definitions = await super().list_tools()
        for definition in definitions:
            definition.inputSchema = {"type": "object", "properties": {}, "additionalProperties": False}
        return definitions

    async def call_tool(self, name: str, arguments: dict[str, Any]):
        if name != "get_site_status" or not isinstance(arguments, dict) or arguments:
            # A fixed error DTO never contains attacker-supplied tool names, keys or values.
            result = unknown_result("ARGUMENTS_REJECTED")
            return formatted_result(result, is_error=True)
        return formatted_result(await execute_fixed())


mcp = FixedStatusMCP("f1-status-readonly", log_level="ERROR")


@mcp.tool(
    name="get_site_status",
    description="F1 / F1+1 网站状态专用只读巡检，无参数，每次重新采样。回复用户时直接使用 content 中给定的中文报告，保留其中完整日期、北京时间 UTC+8、有效期、失败和未知的区别；时间已经转换，不要再按 structuredContent 中的 UTC 时间自行改写。status=failed 表示检查项失败，仍是有效巡检结果。只陈述报告中的观测，不自行诊断人为、调度或 worker 根因，不据旧成功时间推断采集/备份任务没运行，不据服务进程存在推断业务正常。公网仅为 M1 视角，Admin 边界拒绝未验证私网登录；异常根因未查。仅此工具受只读边界约束，禁止自动重试投递、维护或修改生产。",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=True),
    structured_output=False,
)
async def get_site_status() -> dict[str, Any]:
    return await execute_fixed()


if __name__ == "__main__":
    mcp.run(transport="stdio")
