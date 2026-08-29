---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-A85BCA
decision: pass
external_calls: 0
---

# Release clean-only fixture 机械收口报告

## 结论

FF23A7 的测试夹具首错已关闭，生产 release-manifest 字节未改。单一重夹具机械复用生产依赖遍历规则，只复制 manifest 实际读取的 44 包闭包；Git commit 仅跟踪 89 项 runtime，不再把 `.next` 与 `node_modules` 纳入测试 commit。身份门负例继续使用不含 `.next`/依赖的轻量双 commit fixture。

## 变更边界

- 修改：`app/src/tests/admin-release-manifest.test.ts`。
- 回填：`docs/collaboration/部门/开发部/报告/2026-08-12-FF23A7-Release-clean-only身份门实现报告.md`。
- 未修改生产：`app/src/server/admin-service/release-manifest.ts`，SHA-256 为 `075d11bca11675948bb302a957ac9e071f3e5d733d9b1752fa60297c9004581a`。
- 未修改 runbook、`.gitignore`、package、运行闭包或部署现场。

## 验证收据

- 聚焦 Vitest：唯一一次 PASS，`1 file / 2 tests`，`12.36s`。
- 固定 Node 24 typecheck：唯一一次 PASS，退出码 `0`。
- 限定四文件 diff-check：唯一一次 PASS，退出码 `0`。

## 未验证边界

- 当前任务未 stage/commit/push/build/SSH/M1。
- 临时 clean Git fixture 只证明机制；精确白名单提交后仍必须在真实 clean HEAD 重新运行约定三门，再执行 production build / builder / target verifier。
