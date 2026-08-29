---
type: audit_report
department: 安全部
target: "TASK-20260811-76E7E8 剩余SQLite/audit/profile/第二writer出口"
status: final
date: 2026-08-11
related_task: TASK-20260811-76E7E8
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
tags: [SOURCE-MGMT-001, sqlite, audit, profile, ledger, first-failure]
summary: "FAIL。固定Node24唯一进程内harness已通过物理复制+chmod0600、错误basename拒绝、main/temp单DB、唯一profile ledger、integrity ok、59+1与local_synthetic retired/stopped/disabled；首错为harness错误预设inbox/task_attempt各1，实得均0。未建立产品缺陷。按首错停止，audit链、内容根与第二writer仍NOT_RUN；正式DB零漂移，externalCalls=0，临时资源零残留。"
---

# 76E7E8 剩余 SQLite/audit 出口单次安全复验

## 1. 唯一结论

**FAIL；P0=0，P1=1，P2=0。**

固定 Node24 的进程内 harness 精确运行一次。首错发生在 ledger 计数断言：

```json
{
  "fixture_profile_ledger": 1,
  "source_overlay_lineage": 1,
  "source_runtime_fence": 1,
  "operation_receipt": 5,
  "outbox_job": 1,
  "inbox": 0,
  "task_attempt": 0,
  "dead_letter": 0,
  "audit_event": 5
}
```

harness 未从冻结证据取得 `inbox` 与 `task_attempt` 的精确值，错误预设二者均为 1。实得为 0 后触发 `LEDGER_COUNTS` 并退出 1。该 P1 属于安全探针断言错误；现有证据没有建立产品缺陷。按任务合同没有修改预期或重跑。

## 2. 首错前已验证

- closed DB 先物理复制，再独立 `chmod 0600`；副本 SHA 匹配 `ddf3778c…e939`。
- 错误 basename 以 `PROFILE_PATH_MIX`/`DB_PATH` 类安全错误失败关闭。
- SQLite `integrity_check=ok`；`database_list` 仅包含 `main/temp` 允许集合。
- `fixture_profile_ledger` 精确 1 行，`profile_id=source-management-synthetic`。
- Repository 合并视图精确为 59 条 `m3_baseline` 加 1 条 `local_synthetic`。
- 59 条 baseline 全部 `enabled=false`，且没有 baseline ID 落入本地 `source_config_fixture` 表。
- 唯一 local 状态为 `retired/stopped/disabled`。
- operation receipt 为 5、audit event 为 5、outbox job 为 1、dead letter 为 0；`inbox/task_attempt` 的实得均为 0。
- AD6AD9 已证的弱权限副本写前失败关闭被复用，没有重复运行该向量。

## 3. NOT_RUN / 未验证

按首错停止，以下出口没有运行：

- audit update/delete append-only trigger 存在性；
- audit monotonic sequence、previous-event-hash 链、payload/hash 格式、internal/append-only/external_calls/redaction 字段；
- audit operation ID 与 operation receipt 交叉；
- logical content root 与冻结 closed receipt 一致；
- 第二 writer 在打开或 `BEGIN IMMEDIATE` 阶段失败关闭。

因此不能把 742B8D 前半、AD6AD9 弱权限与 70EC0F no-egress 冻结链组合成 875B6C 最终安全 PASS。

## 4. 隔离与零副作用

- formal DB 未打开、未修改，SHA 前后均为 `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939`。
- 未启动 server，未调用 readiness，未初始化 fixture，未运行 raw/session/CSRF/identity/no-egress 动态链。
- 未运行 build、typecheck、全量测试或动态网络；`externalCalls=0`。
- 产品 repo、依赖、UI、Spec、ADR 未修改。
- 任务专属 DB 副本、sidecar、harness 与临时根均已精确清理。

## 5. 已验证 / 未验证 / 错题自检

### 已验证

见第 2 节；所有结论只覆盖首错前实际执行的阶段。

### 未验证

见第 3 节；这些项保持 `NOT_RUN`，未从开发或测试报告继承为安全部独立 PASS。

### 错题自检

- 命中：把不存在于冻结任务真值中的 `inbox=1/task_attempt=1` 当成既定值；实际 retired/stopped local 收据允许这两个运行队列表为空。
- 已按首错停止，没有用实得值修订 harness 后重跑。
- 没有把计数断言错误归因于产品，也没有把已通过的 profile/59+1 结果外推到 audit 链和第二 writer。
- 没有重复弱权限、raw/session/CSRF/identity/no-egress 动态链。

## 6. 最小后继条件

若统筹继续，应由新任务把本轮机器实得 ledger counts 固定为输入，仅运行 audit 链、logical content root 与第二 writer 三组未运行项；不得重复本轮已通过阶段或改写本任务历史。

TASK_STATE_OK
