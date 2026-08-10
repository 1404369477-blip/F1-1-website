---
type: audit_report
department: 安全部
target: "TASK-20260810-7CBD3F canonical shadow profile剩余安全不变量"
status: final
date: 2026-08-10
related_task: TASK-20260810-7CBD3F
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
tags: [SOURCE-MGMT-001, canonical-shadow, sqlite, fail-closed, first-failure]
summary: "FAIL。canonical shadow拓扑与closed DB SHA通过输入门；唯一探针在只读ready检查后因错误要求localRows=0触发INITIAL_LOCAL_ROWS。固定closed receipt明确localSourceCount=1，因此这是安全探针断言错误，未建立产品缺陷。按首错停止，SQLite/audit/no-egress后续向量NOT_RUN；正式DB未打开且SHA零漂移，外联与业务写入均为0，任务临时根已清理。"
---

# 742B8D 后继：canonical shadow profile 剩余安全复验报告

## 1. 唯一结论

**FAIL；P0=0，P1=1，P2=0。**

本轮 P1 是独立安全探针的候选状态断言错误，未建立产品安全缺陷。探针把固定 closed DB 的初始 `localRows` 错误限定为 `0`；同一固定 DB 的既有 closed receipt 明确记录 `localSourceCount=1`。唯一探针在 readiness 检查之后、任何业务 mutation 之前触发 `INITIAL_LOCAL_ROWS` 并以退出码 1 停止。

依任务“首错停止”合同，没有修改断言或重跑，也没有继续 SQLite/audit/no-egress 向量。742B8D 已记录为 PASS 的 raw/session/CSRF/identity 阶段没有重复执行。

## 2. 输入门与 canonical shadow

| 检查项 | 实得 |
|---|---|
| shadow project/app 根 | 任务专属目录，目录权限 `0700` |
| shadow DB 路径 | `shadow project/app/.local/f1plus1-source-management-synthetic.sqlite` |
| `F1_DB_PATH` | 精确 `.local/f1plus1-source-management-synthetic.sqlite` |
| shadow DB 文件权限 | `0600` |
| shadow DB 输入 SHA-256 | `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939`，MATCH |
| 正式 DB SHA-256 | 运行前后均为 `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939` |
| 依赖 | shadow 内只读链接指向项目现有 `node_modules`；没有安装或修改依赖 |

shadow 使用物理复制的源码、迁移、fixture 与 closed DB。产品接受 canonical profile 路径并进入 readiness 检查，前序 `PROFILE_PATH_MIX` 已消失。

## 3. 首错与定级

机器首错：

```json
{
  "reasonCode": "INITIAL_LOCAL_ROWS",
  "phase": "canonical shadow readiness completed; before business mutation",
  "expectedByProbe": 0,
  "pinnedClosedReceiptLocalSourceCount": 1,
  "productDefectEstablished": false
}
```

定级为 P1 的原因：本任务验收出口要求在固定 closed DB 上完成剩余安全不变量；探针错误的初始状态假设阻断了这些证据，无法给出安全 PASS。产品对 canonical profile 的处理没有失败，fixed DB 也没有漂移。

## 4. 已验证

- 任务专属 shadow project/app 拓扑与 canonical 相对 DB 路径成立。
- closed DB 副本 SHA 与任务固定值一致，文件权限为私有模式。
- 产品成功打开 shadow canonical profile 并完成 readiness 检查；没有再次出现 `PROFILE_PATH_MIX`。
- 固定 closed receipt 的 `localSourceCount=1`、`externalCalls=0`、`walPresent=false`、`shmPresent=false` 已与首错原因交叉核对。
- 正式 DB 没有打开或修改，运行前后 SHA 零漂移。
- 产品实例、listener、provider、真实外部能力均未启动；外部 I/O 为 0。
- shadow 中没有执行业务 mutation；任务临时根、进程外 lock/WAL/SHM 已随任务根精确清理。

## 5. NOT_RUN / 未验证

按首错停止，以下剩余出口均为 NOT_RUN：

- 59 条 baseline 不可变与既有 1 条 local overlay 的独立交叉复验；
- operation receipt、operation identity 与 audit ledger/hash 链交叉；
- 第二 writer、profile/path/permission 拒绝；
- audit update/delete 拒绝及错误/日志脱敏；
- no-egress guard 的 DNS、非 loopback 与 outbound 防御性拒绝。

这些项不能继承开发或测试证据成为安全部独立 PASS。875B6C 的完整安全出口仍未闭合。

## 6. 错题自检

- 命中：把 successor 的“59 baseline + 1 local overlay”误读为“closed DB 初始 localRows=0，再新增 1 条”。固定 closed receipt 已明确保存 1 条 local source。
- 已按首错停止，没有通过修改探针和重跑掩盖首轮实得。
- 没有把探针断言错误定性为产品缺陷，也没有覆盖 A5F239、742B8D 的历史状态。
- 没有打开正式 DB、访问外部网络、启动实例或修改产品文件。

## 7. 后继最小合同

若统筹决定继续，应创建新的最小 successor，并把固定 closed receipt 的 `localSourceCount=1` 作为初始真值；只完成本报告第 5 节 NOT_RUN 项。新任务不得重复 raw/session/CSRF/identity，也不得复用或改写本任务首轮历史。

TASK_STATE_OK
