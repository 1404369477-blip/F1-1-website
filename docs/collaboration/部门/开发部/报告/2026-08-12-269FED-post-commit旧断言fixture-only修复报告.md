---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-269FED
decision: pass
external_calls: 0
---

# Post-commit 旧断言 fixture-only 修复报告

## 结论

仅修改 `app/src/tests/admin-release-manifest.test.ts`，将已经失效的“当前项目 runtime 必须 dirty”断言替换为动态读取当前 clean HEAD 的 commit、tree、parent 并核对 `resolveAdminReleaseGitIdentity()`。没有硬编码 `2ff…`，生产、runbook 与 `.gitignore` 均未修改。

## 验证

- 聚焦 Vitest：唯一一次 PASS，`1 file / 2 tests`，`13.60s`。
- 固定 Node 24 typecheck：唯一一次 PASS，退出码 `0`。
- 单测试文件 `git diff --check`：唯一一次 PASS，退出码 `0`。
- 测试文件新 SHA-256：`3f44895f66184512e9d22cbd47b719bacec0c4e6bd15eb504186672b1f2d5082`。
- 生产 `release-manifest.ts` SHA-256 保持 `075d11bca11675948bb302a957ac9e071f3e5d733d9b1752fa60297c9004581a`。
- 除测试路径外的 88 项 runtime 定向 status 为空；production runtime 零漂移。提交态 89 项 runtime SHA 集合收据为 `648e7beef7a92e7ce59d5fe4a6d88cb8cda8fcd90c11cad5ef89d5641456a1db`。

## 后继边界

下一步必须使用精确单文件 pathspec 提交测试修正并复核新 commit 为单 parent、index 为空、89/89 runtime tracked/status clean/blob=HEAD。完成该后继检查点后，才可放行唯一 production build；本任务未 stage、commit、push、build、builder、SSH 或 M1。

TASK_STATE_OK
