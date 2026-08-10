---
type: audit_report
department: 测试部
target: TASK-20260810-4CBFA7
status: final
date: 2026-08-10
related_task: TASK-20260810-4CBFA7
decision: fail
tags: [M5, source-management, successor, HTTP, session]
summary: 静态合同与冻结SHA通过；唯一启动在监听前以FIXTURE_PATH失败，按首错停止，未建立产品缺陷，也未关闭A3293F的destroy缺口。
p0: 0
p1: 1
p2: 0
---

# TASK-20260810-4CBFA7 最小 successor 独立复验报告

## 结论

`FAIL`，P0=0、P1=1、P2=0。

A3293F 的历史 FAIL 与“产品缺陷=false”保持不变。本 successor 启动前确认冻结候选 SHA、closed DB 物理副本 SHA、`meta.origin=local_synthetic` 和精确 `x-f1-csrf-token` 均匹配。唯一一次启动在 readiness 阶段、监听前以 `FIXTURE_PATH` 拒绝，收据为 `readyReached=false`、`profileLabel=unknown`、`externalCalls=0`。任务要求首错停止，因此没有修正临时装配或重启。

本轮未建立新的产品缺陷。P1 表示独立 successor 未完成 59+1 与 session destroy 出口闭合。

## 已验证

- A3293F 报告、manifest、raw receipt SHA 分别为 `a81910b…ef67`、`7fa1cf50…e5a`、`20dc8338…3663`，历史证据未覆盖。
- 875B6C 开发报告、manifest、`security.ts` SHA 分别为 `022e1d2d…910f`、`1d402722…519e`、`a455df96…f965`。
- 正式 closed DB 与 0700 临时根内物理副本均为 `ddf3778c…2e939`；启动后正式 DB 仍为同一 SHA。
- 独立 harness 只断言 `local_synthetic`，只发出精确 `x-f1-csrf-token`；不含 `local_overlay`，也不包含 add/validate/activate/stop/retire/requeue 业务矩阵。
- 唯一启动次数为 1；失败发生在监听前；没有 3019 listener；`externalCalls=0`。

## 未验证与阻断

- health 200。
- list 中 59 baseline + 1 local，且 local 为 `local_synthetic` / retired / stopped / disabled。
- session destroy 204，以及 destroy 后 list 401 `ADMIN_SESSION_REQUIRED`。

阻断原因精确为独立临时 profile 的 readiness `FIXTURE_PATH` 拒绝。现有收据不足以判断具体路径子条件，也不足以归因产品实现；本任务不追加诊断性重跑。

## 错题自检

- 已使用合同值 `local_synthetic`，没有延续 A3293F 的 `local_overlay` 错误。
- 遵守首错停止；没有修改 harness 后重跑、没有第二实例、没有重复 A3293F 业务矩阵。
- 没有运行 build、typecheck、全量测试；没有修改候选、正式 DB、依赖或外部资源。
- 没有把临时 profile readiness 失败写成 App 产品缺陷，也没有外推 HTTP/destroy PASS。

机器证据：[evidence-manifest.json](TASK-20260810-4CBFA7-evidence/evidence-manifest.json)。

TASK_STATE_OK
