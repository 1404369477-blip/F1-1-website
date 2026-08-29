---
title: TASK-20260811-1FB5FE profile-scoped验证器迁移与legacy收据原子刷新首错阻断报告
date: 2026-08-11
department: 开发部
task_id: TASK-20260811-1FB5FE
status: blocked
externalCalls: 0
---

# 结论

TASK-20260811-1FB5FE 按唯一聚焦批次的首错正式阻断，未进入 canonical receipt 刷新。

实现候选已经完成静态收敛并通过只读对抗审查，P0=0、静态 P1=0；固定 Node 24.18.0 聚焦批次仅运行一次，结果为 `exit 1`、`3/5 PASS`、`2/5 FAIL`。首个可执行错误是 `app/src/tests/profile-closed-receipt.test.ts:266` 使用了未导入的 `unlinkSync`。同一批次还发现既有 symlink 负例仍假设 `app/.local/receipts` 不存在，而新事务初始化会先创建该目录，因而在测试第409行得到 `EEXIST`。

遵照任务失败路径，本轮没有修复这两处测试、没有第二次运行聚焦测试、没有运行 M3/public 受控生成命令，也没有运行 0F65C1 整链。

# 候选实现

- legacy M3/public 入口与 SOURCE-MGMT 入口已拆为两个脚本和两个 package command；SOURCE receipt 未生成。
- `legacy-profile-validator-v2` 使用独立 canonical manifest，当前冻结：
  - `closed-receipt.ts`：`099c571ec2034ad74d6a2ebed3ca501e0414e2c0c262ba0d24b7823bc6ece820`
  - legacy CLI：`ecd8706b7962e41660255c4bd11eebdbdad193ccc945f1d8e442bb6cb8e64ea8`
  - scoped root：`712fe5d6e9d693eaf0d531b481253374d9c5a8b4d912ab4f05157700879f57f2`
- 旧 root `2a8c89ace30b1e9cac876adb0583ec47e43ce6d6806616a58fac7823ca586d83` 仅在其余稳定字段全等时允许迁移；迁移后由 receipt 目录外的 profile marker 拒绝旧字节回放。
- M3 首次迁移按 receipt+marker 集合提交；public 按 profile receipt+data receipt（首次再含 marker）集合提交。
- 集合提交使用私有持久 transaction journal、候选和 rollback 字节；入口先恢复。恢复前要求目标为 old/candidate/缺失三态之一，第三种 hash fail closed。
- 测试候选使用独立子进程 `SIGKILL` 故障点覆盖 M3 首次迁移首个 rename、public 首次迁移全部 rename、public 刷新首个 rename、恢复中再次中止和第三态拒绝。该测试因上述首个测试代码错误，相关用例未跑到完成态。
- closed-receipt 两个 CLI 的内部生成错误统一压缩为 `RECEIPT_INTEGRITY`；参数错误仍保持既有 allowlist。输出不含内部码、路径、stack 或载荷。
- public-multimedia runtime 冻结为同一 validator root，并要求两份外置迁移 marker；24小时 freshness 表达式未修改。

# 唯一聚焦批次收据

固定运行时：项目内 Node `24.18.0`，clean env，未调用网络。

```text
env -i HOME="$HOME" PATH="$PWD/.local/toolchains/node-v24.18.0-darwin-arm64/bin:/usr/bin:/bin" TMPDIR=/tmp LANG=C LC_ALL=C NEXT_TELEMETRY_DISABLED=1 \
  .local/toolchains/node-v24.18.0-darwin-arm64/bin/node \
  node_modules/vitest/vitest.mjs run src/tests/profile-closed-receipt.test.ts --config vitest.config.ts

exit=1
tests=5
passed=3
failed=2
duration=839ms
```

首错：

```text
ReferenceError: unlinkSync is not defined
src/tests/profile-closed-receipt.test.ts:266:5
```

同批次第二条错误：

```text
EEXIST: file already exists, symlink .../external-receipts -> .../app/.local/receipts
src/tests/profile-closed-receipt.test.ts:409:5
```

# canonical 保护核验

聚焦测试只使用 `/tmp` 隔离工程；`afterEach` 已清理其登记目录。只读收口没有发现 canonical WAL、SHM、tmp、lock 或 transaction 目录。

| 对象 | 收口 SHA-256 | 结论 |
|---|---|---|
| `app/.local/f1plus1.sqlite` | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` | 与任务前基线一致 |
| `app/.local/f1plus1-public-synthetic.sqlite` | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` | 与任务前基线一致 |
| M3旧receipt | `4309961dd363413444821f29586a15eec96cc18b396a3f8aad44330ec5d5bbdc` | 未刷新 |
| public profile旧receipt | `2c5ca3555b108761fb5b224e0cad77a29d8fc16e56d3eb4d6b80448365492803` | 未刷新 |
| public data旧receipt | `71286412fcfc04428145b86ba2a174d93417e6604f16883a7a5a87f7e76cacdc` | 未刷新 |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | 零漂移 |

没有读取或输出任何 token/secret 值；`externalCalls=0`。

# 已验证

- 任务状态已正式 claim；候选限定于 receipt validator、入口、安全 reason、public runtime root、聚焦测试和 package script。
- `git diff --check` 对候选文件 PASS。
- validator manifest 的两项 artifact hash、scoped root 和 public runtime root 静态一致。
- 只读对抗审查最终结论 P0=0、静态 P1=0。
- 唯一聚焦批次中的基础重复生成用例、unknown-root/恢复用例、入口/脱敏用例共3项 PASS。
- canonical 两库、三份旧 receipt 与 package-lock 保持任务前 SHA；无 canonical sidecar/transaction 残留。

# 未验证

- 聚焦批次整体 PASS：FAIL，禁止重跑。
- 旧 root 到 v2 root 的完整运行迁移、真实子进程首次迁移矩阵：被测试首错截断。
- M3与public既有受控入口各一次刷新、三份新 receipt canonical/self-hash/freshness/权限/nlink：NOT_RUN。
- 新 marker 的 canonical 生成与 public runtime 对新 receipts 的真实 readiness：NOT_RUN。
- 0F65C1 后续整链、浏览器、外部能力：不在本任务且 NOT_RUN。

# 错题自检

- 流程偏差：任务已被先行 claim，随后 `declare-impact` 被协议工具以“只能在 queued 状态声明”拒绝；未手改任务 JSON。后续任务应在 claim 前完成 impact 声明。
- 实现偏差：新增测试调用 `unlinkSync` 时遗漏 import，静态 diff 检查无法发现该运行错误。
- 测试隔离偏差：既有 symlink 负例没有先移除新实现会创建的 receipts 目录，导致测试准备阶段 `EEXIST`，未命中原安全断言。
- 约束遵守：首个聚焦批次非零后立即停止，没有以“机械修复”为由追加第二轮测试或 canonical 刷新。

# 后续最小恢复门

后继只需在新任务或本任务正式 resume 后：

1. 精确补入 `unlinkSync` import；
2. 在 symlink 负例创建链接前安全移除该测试临时工程内已创建的空/受控 receipts 目录；
3. 重新冻结候选 hash/root（若仅测试文件变化，validator root不变）；
4. 按新授权仅运行一次同规格聚焦批次；PASS 后才允许执行 M3/public 各一次受控刷新与最终完整性回算。

当前任务判定：`BLOCKED`，不得回传 `TASK_STATE_OK`。
