---
type: audit_report
department: 测试部
target: TASK-20260802-3760F6；Next启动受控输出冻结候选
status: final
date: 2026-08-04
related_task: TASK-20260804-1E075C
decision: fail
tags: [M4, VS-0, next-startup, isolated-snapshot, candidate-drift, not-run]
summary: 三个目标文件SHA与开发报告一致，但隔离快照已包含并发SQLite任务写入的未完成迁移占位值，唯一一次有效目标套件因此7/13通过、6项在运行时准备阶段失真失败；未继续happy path或完整check。本轮按候选闭包污染记NOT_RUN，P0=0、P1=1、P2=0，不判定3760功能失败。
---

# Next 启动受控输出候选闭包污染 NOT_RUN 报告

## 1. 唯一结论

`decision=FAIL / NOT_RUN`。

本轮不能对 `TASK-20260802-3760F6` 的功能候选给出通过或失败结论。三个目标文件的 SHA-256 与开发报告逐项一致，但复制完整 `app/` 后，隔离快照已经包含另一项并发 SQLite 开发的未完成传递依赖：`app/src/server/db/database.ts` 的 schema v3 收据值为字面量 `TO_BE_REPLACED`。该在途占位值使 runtime migrate/ready 先于 Next 后置失败验收失真。

| 级别 | 数量 | 结论 |
|---|---:|---|
| P0 | 0 | 未发现正式 `.next` 被移动、删除或改写，也未发现端口或测试进程残留 |
| P1 | 1 | 冻结对象只固定三个直接文件，未冻结可执行候选的完整传递闭包；并发开发可使独立验收失真 |
| P2 | 0 | 本轮没有新增一般问题 |
| 唯一判定 | FAIL / NOT_RUN | 不判定 3760 功能失败；完整闭包形成稳定候选后需重新派一次窄验收 |

## 2. 冻结输入与漂移证据

开始时将 `app/`、现有 `.next` 和任务列明的三组只读 data 依赖复制到独立临时目录；`node_modules` 与固定 Node 24.18.0 工具链只读复用。三个目标文件在正式工作树和隔离副本中的 SHA-256 均为：

| 文件 | SHA-256 | 与开发报告 |
|---|---|---|
| `app/scripts/serve.ts` | `5ee435346a1c061eb15a93ac41dd40f61d831db23a0df04652a7c59ecf0a6979` | 一致 |
| `app/scripts/p1-acceptance.ts` | `bcfd9f8a2f2a92ccea81007debff2b7baf1c443b2174711e025d6d81ec50d29c` | 一致 |
| `app/src/tests/p1-cli.test.ts` | `6142415116139ca3b2fa8f3ed7fd931189324551a336c9ef67ea7344fbb6f71e` | 一致 |

隔离副本中的传递依赖同时出现：

```text
app/src/server/db/database.ts
EXPECTED_SCHEMA_SHA256 version 3 = "TO_BE_REPLACED"
```

这不是开发报告列出的 3760 冻结状态，也不是可执行候选的稳定收据。仅凭三个直接文件 SHA 无法把当前运行结果归因给 3760。

## 3. 唯一一次有效目标套件结果

按任务限制只执行一次有效的 `src/tests/p1-cli.test.ts` 目标套件，没有运行完整 `check`：

```text
Test Files  1 failed (1)
Tests       6 failed | 7 passed (13)
```

六项失败均与已污染的运行时准备链一致：

- missing runtime database 的预期 `HEALTH_DB_MISSING` 被提前收敛为 `CLI_INTERNAL_ERROR`；
- fixture-path 负例的预期 `FIXTURE_PATH` 被提前收敛为 `CLI_INTERNAL_ERROR`；
- migration ledger drift 无法完成初始 migrate；
- dev 端口冲突、start 端口冲突、start 缺失 `.next` 三项均无法通过 `createReadyRuntime`，因此没有到达要审核的 Next 后置失败出口。

剩余 7 项通过不能单独构成放行。三类核心后置失败未到达目标出口，所以也不能据此断言输出边界回归。

## 4. 停止边界与清理收据

发现候选闭包污染后立即停止：

- 没有运行正常 start/health/SIGINT happy path；
- 没有运行完整 `npm check`；
- 没有追加同质探针或重复目标套件；
- 正式 `app/.next` 与测试前隔离副本逐文件一致，共 186 个文件；
- 3000、3101 均无监听；目标套件创建的 `f1plus1-p1-next-*` 临时目录为 0；隔离副本内测试数据库为 0；
- 精确临时副本及其路径标记已清理。

正式项目内只新增本测试部 final 报告并更新任务状态；未修改 `app/`、`data/`、Spec、accepted ADR、design、lockfile 或外部资源。

## 5. 未验证项与后续门禁

本轮未验证：

- 三类 Next 后置失败在稳定完整候选上的 exact 四字段安全 JSON；
- 正常 production start、health、SIGINT、端口与进程组清理闭环；
- 3760 候选的最终 PASS/FAIL。

后续只需在 SQLite 开发形成明确稳定候选后重派一次窄验收。冻结入口需绑定完整传递闭包，可采用精确 worktree/commit、全量候选 manifest，或至少覆盖 migration、runtime-config、database、health、security CLI、serve、验收脚本、目标测试、package/lock、`.env.example` 与必要 data 收据。仍只运行一次目标套件和一次 happy path。

## 6. 错题自检

- 没有把并发任务造成的失真写成 3760 功能失败。
- 没有因三个直接 SHA 一致就忽略运行时传递依赖的占位值。
- 第一次测试启动器调用缺少有效工作目录且没有产生测试输出，已判为无效调用且未计入验收；随后只运行了一次有效目标套件。发现候选污染后没有重试。
- 没有为凑齐验收项继续运行 happy path、完整 check 或同质探针。
- 没有修代码、ACK、放行 VS-0、R5、R12 或任何真实外部能力。

