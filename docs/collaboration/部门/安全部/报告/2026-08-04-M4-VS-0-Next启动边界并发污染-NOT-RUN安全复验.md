---
type: audit_report
department: 安全部
status: final
date: 2026-08-04
related_task: TASK-20260804-1F16EC
domain_stage: M4-VS0-next-output-security-recheck
execution_mode: isolated_read_only_security_review
decision: fail
severity_count: { P0: 0, P1: 0, P2: 1 }
target: "TASK-20260802-3760F6 Next输出脱敏与缓存进程边界候选"
target_revision: "七个任务冻结文件SHA匹配，但必要运行依赖闭包在任务完成后被并发SQLite任务修改"
tags: [M4, VS-0, next, security-review, not-run, concurrent-drift]
summary: "FAIL/NOT_RUN：任务指定的7个冻结SHA仍全部匹配，但3760于13:25完成后，运行闭包中的migration与database依赖在13:29被并发SQLite开发修改；隔离副本无法可信复现原候选的端口冲突和SIGINT路径。按任务失败路径立即停止，未对功能缺陷作出断言；应在SQLite任务稳定后重派绑定完整运行依赖SHA的极窄复验。"
---

# M4 VS-0 Next启动边界并发污染 NOT_RUN 安全复验

## 1. 结论

本轮为 **FAIL / NOT_RUN**，`P0=0 / P1=0 / P2=1`。

该结论表示审核对象的必要运行依赖闭包没有被冻结，因此无法产生可用于安全放行的行为证据。它不证明 `serve.ts` 整改存在新功能缺陷，也不能将 P0/P1 视为已验证通过。

## 2. 冻结目标核对

`TASK-20260802-3760F6` 开发报告列出的7个文件 SHA-256 在本轮取样时全部逐字匹配：

| 文件 | SHA-256 | 结果 |
| --- | --- | --- |
| `app/scripts/serve.ts` | `5ee435346a1c061eb15a93ac41dd40f61d831db23a0df04652a7c59ecf0a6979` | PASS |
| `app/scripts/p1-acceptance.ts` | `bcfd9f8a2f2a92ccea81007debff2b7baf1c443b2174711e025d6d81ec50d29c` | PASS |
| `app/src/tests/p1-cli.test.ts` | `6142415116139ca3b2fa8f3ed7fd931189324551a336c9ef67ea7344fbb6f71e` | PASS |
| `app/src/server/security/cli.ts` | `1126cca2471da18160b8d870bd4a1d030610324e5b0c1e1ccbf78e4c7ce42e85` | PASS |
| `app/src/server/security/log.ts` | `f69347a4d054cb4ce05f92bd333fba4b80b00dfe21108db110da12c7e41e4b00` | PASS |
| `app/package.json` | `cb81c6be9db1772537dfc2a53214bf03d7f92f763a701d20c68789d68d1fd452` | PASS |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | PASS |

但这 7 个文件不足以构成可运行的 `start`、runtime readiness、端口冲突与信号清理闭包。开发任务于 2026-08-04 13:25 完成后，另一个并发 SQLite 开发任务于 13:29 新增/修改了必要依赖：

| 并发依赖 | 当前 SHA-256 | 文件时间 |
| --- | --- | --- |
| `app/migrations/0003_public_synthetic_profile.sql` | `57df4d990cded9d69551d0acf97615ef5d9fd3d5ecceb05ebb10d3812549498a` | `2026-08-04T13:29:08+0800` |
| `app/src/server/db/database.ts` | `83946052dea43063aced74f182cc30010d8b6f3fbb9c9d8520300571a7fdf48e` | `2026-08-04T13:29:08+0800` |

原任务没有绑定这两个文件及其他runtime/DB/fixture/build依赖的完整 SHA 集，审核方无法从当前工作树还原 13:25 的精确可运行候选。

## 3. 隔离复验的停止证据

本轮将当前 `app/` 和 m3-shadow 所需的3个只读 data 目录复制到 `TemporaryDirectory`，`node_modules` 只读引用现有安装；未在正式工作树运行攻击、迁移 `.next` 或写入 DB。隔离副本中 7 个指定 SHA 二次仍精确匹配。

但隔离副本在为最高风险的 `start` 端口冲突路径准备runtime时，`db:migrate` 立即以封闭四字段输出拒绝：

```json
{"event":"cli_failure","status":"rejected","reasonCode":"MIGRATION_SCHEMA","externalCalls":0}
```

这一结果与 13:25 开发报告中 migration/seed/runtime ready 的候选状态不同，且时间与 13:29 并发修改一致。按本任务失败路径“候选 SHA 受并发开发影响时立即 NOT_RUN”，本轮没有继续端口占用、没有启动 Next，也没有执行 SIGINT 清理探针。

## 4. 有限静态审查

在发现并发污染前已完成的只读静态核对表明：

- `serve.ts` 仍在runtime readiness之前拒绝附加 argv，字面 hostname/port 仍是 `127.0.0.1:3000`。
- Next child 的 stdout/stderr 都设为 pipe 并在父进程内排空，child `error` 和非零 `exit` 转换为 `CLI_INTERNAL_ERROR`，再由 `runSafeCli` 输出四字段封闭 JSON。
- 父进程为 `SIGINT/SIGTERM` 安装一次性handler，转发到child并在 child 终止后移除handler；静态实现没有改动共享 `.next`。
- 以上只是控制流证据。本次缺少可信行为候选，不将它扩大为 P0/P1 PASS。

## 5. 分级与处置

| 级别 | 数量 | 内容 |
| --- | ---: | --- |
| P0 | 0 | 未发现；本轮没有执行可支持放行的行为验证。 |
| P1 | 0 | 未对候选功能缺陷作出断言；同样不能声称 P1 已验证清零。 |
| P2 | 1 | 独立审核任务只冻结了7个直接文件，没有冻结可运行runtime/DB/migration/fixture/build依赖闭包，与并发开发冲突后无法可信复验。 |

处置建议只有一项：等当前 SQLite 开发候选稳定后，由统筹部重派一个极窄安全复验，用一个原子manifest绑定 `serve/p1-acceptance/p1-cli`、security输出边界、runtime/DB/migration/fixture/build 依赖和相应 SHA。行为仍只做一个 `start` 端口冲突和一次 SIGINT 清理，无需重跑完整check、测试部套件或同质攻击。

## 6. 已验证 / 未验证

### 已验证

- 任务指定的7个 SHA 在工作树和隔离副本都精确匹配。
- 并发修改的两个必要依赖时间均晚于3760完成时间，隔离runtime准备实际以封闭 `MIGRATION_SCHEMA` 拒绝。
- `serve.ts`、`p1-acceptance.ts`、`p1-cli.test.ts`、`cli.ts`、`log.ts` 的stdio/signal/error边界已只读核对。
- 没有修改正式 app/data/Spec/ADR/design/lock，没有运行完整check或测试部套件。

### 未验证

- 最高风险后置失败 `start` 端口冲突：NOT_RUN。
- 一次 SIGINT 后的child/process-group/3000/3101清理：NOT_RUN。
- 父子进程的实际stdout/stderr唯一四字段输出：NOT_RUN。
- R5同UID、R12系统调用级no-egress、VS-0整体及真实外部能力：仍未验证且未放行。

## 7. 错题自检

- 没有因7个直接文件 SHA 匹配就忽略可运行依赖闭包的并发漂移。
- 没有把隔离副本的 `MIGRATION_SCHEMA` 当作 `serve.ts` 功能缺陷，也没有为取得 PASS 继续调整候选或重试。
- 没有在共享工作树占用端口、移动/删除 `.next`、终止其他任务进程或修复代码。
- 没有用开发报告的自测结论代替独立安全行为证据。
- 本轮只记录一个审核完整性 P2，不追加冗余测试。

## 8. 任务收据

TASK_STATE_OK
