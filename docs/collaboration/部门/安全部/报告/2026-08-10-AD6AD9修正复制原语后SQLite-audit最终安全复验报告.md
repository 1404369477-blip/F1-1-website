---
type: audit_report
department: 安全部
target: "TASK-20260810-AD6AD9 修正复制原语后的SQLite/audit最终缺口"
status: final
date: 2026-08-10
related_task: TASK-20260810-AD6AD9
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
tags: [SOURCE-MGMT-001, sqlite, audit, permissions, harness, first-failure]
summary: "FAIL。固定Node24唯一进程内harness已按要求先物理复制closed DB再独立chmod 0600；在弱权限副本负例处，产品正确fail-closed并返回DB_PATH，但harness过度限定为DB_PERMISSIONS，导致首错exit1。未建立产品缺陷。按首错停止，其余SQLite/audit/第二writer向量NOT_RUN；正式DB零漂移，server/readiness/fixture初始化/动态网络均未调用，externalCalls=0，临时资源已清理。"
---

# AD6AD9 修正复制原语后 SQLite/audit 最终安全复验

## 1. 唯一结论

**FAIL；P0=0，P1=1，P2=0。**

固定 Node24 的唯一 harness 已执行一次。70EC0F 的复制原语错误已正确修正：先物理复制 closed DB，随后独立执行 `chmod 0600`。复制副本 SHA 与冻结 closed DB 一致。

首错发生在弱权限副本负例。harness 把副本改为 `0644` 后调用 `openSafeDatabase`，产品立即拒绝，实际错误为：

```text
DB_PATH: database guard is not a private regular file
```

harness 只接受 `DB_PERMISSIONS`，因此把已经失败关闭的安全结果误判为断言失败并以退出码 1 结束。该 P1 属于安全探针 reason-code 断言过窄，未建立产品缺陷。依任务合同，没有修改断言或重跑。

## 2. 已验证

- harness 命令次数精确为 1，固定 Node `24.18.0`。
- closed DB 使用物理复制，再独立 `chmod 0600`；副本 SHA 与 `ddf3778c…e939` 一致。
- `0644` 弱权限副本无法打开，产品在 DB 使用前 fail-closed。
- formal closed DB 未打开、未修改，运行后 SHA 仍为 `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939`。
- no-egress 冻结链继续匹配：guard `5f0085…56d2`、server `5c4091…378f`、91AF6E manifest `7b0658…187b3`、F213DE 报告 `745ddd…757f`。
- 未启动 server，未调用 readiness，未初始化 fixture，未触发动态网络；`externalCalls=0`。
- 任务专属临时 DB、sidecar、harness 和临时根已清理。

## 3. NOT_RUN / 未验证

按首错停止，以下出口未运行：

- 错误 basename 的 profile 拒绝；
- main/temp 单 DB 与唯一 profile ledger；
- 59 baseline + 1 local、`local_synthetic`、retired/stopped/disabled；
- operation/outbox/inbox/task/audit/ledger 计数；
- audit 顺序、previous hash 链、internal/append-only/external_calls/redaction 字段；
- logical content root 与 frozen receipt 一致；
- 第二 writer 失败关闭。

742B8D 前半 PASS 与 no-egress 冻结证据保持有效，但本轮未关闭上述 SQLite/audit 缺口，因此 875B6C 仍不能获得最终安全 PASS。

## 4. 错题自检

- 命中：弱权限输入的安全合同要求“拒绝”，harness 额外绑定了具体 reason code `DB_PERMISSIONS`；实现返回 `DB_PATH` 仍然完成写前失败关闭。
- 已按首错停止，没有扩大 reason-code allowlist后重跑。
- 没有把 harness 断言错误归因于产品，也没有把弱权限拒绝外推为其余 SQLite/audit 向量 PASS。
- 没有修改 repo、正式 DB、依赖、UI、Spec 或 ADR。
- 没有运行 build、typecheck、全量测试、server、readiness、fixture 初始化或动态网络。

## 5. 后继最小条件

若统筹继续，新 successor 应把弱权限负例的验收语义限定为“在 DB 使用前以 allowlist 的安全错误失败关闭”，并由任务真值明确允许 `DB_PATH` 或 `DB_PERMISSIONS`；其余 harness 不变且只运行一次。本任务历史不得改写。

TASK_STATE_OK
