---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-FF23A7
decision: pass
external_calls: 0
---

# Release clean-only 身份门实现报告

## 结论

D357B3 发现的唯一 P1 已关闭。release builder 中的 `54e694c…` legacy dirty-overlay 分支、常量、路径表与辅助函数全部删除。builder 现在只接受单 parent HEAD、89/89 runtime 全部 tracked、runtime path status 完全为空、逐工作树 blob 等于 HEAD blob 的 clean Git 检查点。当前 `54e694c…` 脏工作树调用 builder 明确 fail closed。

## 四文件边界

- `app/src/server/admin-service/release-manifest.ts`
- `app/src/tests/admin-release-manifest.test.ts`
- `app/ADMIN-SERVICE-PREP.md`
- `docs/collaboration/部门/开发部/报告/2026-08-12-FF23A7-Release-clean-only身份门实现报告.md`

`.gitignore` 继续保持已审 SHA `b59c2af8b102be6e00d97efb931d0ffdfb5f6d8eda60806e224dda09d2c9c79b`，本任务未修改。

## 实现与测试覆盖

- clean 临时 Git fixture 有两个真实 commit，HEAD 为单 parent，89 项 runtime 全部 tracked 且 clean，用于生成 manifest。
- 成功路径在 fixture 内验证 Git commit/tree/parent、runtime、Next、dependency、Node、content/release roots 和 fresh stage target verifier。
- 负例覆盖当前脏项目、modified、deleted、staged、intent-to-add 伴随 runtime dirty、rename、untracked replacement、HEAD 不跟踪 runtime、merge commit。
- target verifier 继续要求外部 manifest SHA，拒绝 Git 字段形状错误、拒绝未更新 release root 的 40 位 Git 字段替换，拒绝 target `.next` 字节漂移。
- package 五 script / lock 依赖、Next、Node、target verifier 完整闭包未放宽。

## 验证收据

- 聚焦 release Vitest：由 fixture-only successor `TASK-20260812-A85BCA` 唯一执行一次并 PASS，`1 file / 2 tests`，耗时 `12.36s`。
- Node 24 typecheck：由 `TASK-20260812-A85BCA` 唯一执行一次并 PASS，退出码 `0`。
- 限定四文件 diff-check：由 `TASK-20260812-A85BCA` 唯一执行一次并 PASS，退出码 `0`。
- 生产 `release-manifest.ts` 在 successor 中保持 SHA-256 `075d11bca11675948bb302a957ac9e071f3e5d733d9b1752fa60297c9004581a`，未发生字节变化。

## 下一步唯一安全顺序

1. 只按 A7D590 的精确白名单形成 commit，禁止宽范围 add。
2. 提交后在 89/89 runtime 对新 HEAD clean 的状态下，重新执行唯一一次聚焦 Vitest、Node 24 typecheck 和限定 diff-check。
3. 三门 PASS 后才允许 production build / builder，生成新的外部 manifest SHA。
4. 使用新外部 SHA 执行 target verifier；历史 `d14ee6…` manifest 或 M1 `8e70b2b7…30a` 收据不能替代新检查点的验证。

## 未验证与错题自检

- 本任务不 stage/commit/push/build/SSH/M1，因此真实 post-commit clean HEAD 仍待后继验证。
- 临时 fixture 不代替实际候选 commit；它只验证 clean-only 机制。
- 没有保留 legacy/dirty builder 入口，也没有用形状门代替 target 的外部 SHA 与完整 roots 重算。
