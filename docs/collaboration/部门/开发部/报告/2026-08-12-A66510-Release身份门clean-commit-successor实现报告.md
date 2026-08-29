---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-A66510
decision: pass
external_calls: 0
---

# Release 身份门 clean-commit successor 实现报告

## 结论

A7D590 确认的两项 P1 已在最小五文件边界内关闭：release builder 已可从单 parent、89 项 runtime 全部 tracked、runtime worktree/index clean 且逐 blob 等于 HEAD 的 Git 检查点动态记录 commit/tree/parent；当前未提交候选只保留唯一 `54e694c…` legacy 入口，必须 58 项 base 与 31 项 ` M`/`??` overlay 的路径、状态和字节完整精确匹配。根 `.gitignore` 已加入 `app/evidence/`，不删除任何历史证据。

## 产物

- `app/src/server/admin-service/release-manifest.ts`
- `app/src/tests/admin-release-manifest.test.ts`
- `app/ADMIN-SERVICE-PREP.md`
- `.gitignore`
- `docs/collaboration/部门/开发部/报告/2026-08-12-A66510-Release身份门clean-commit-successor实现报告.md`

最终 SHA-256：

- `app/src/server/admin-service/release-manifest.ts`：`8ac445e74fcd209119903c0a11e7e09f562efa942f8eceb26ff4aed0bf2ec23c`
- `app/src/tests/admin-release-manifest.test.ts`：`c951c1d953fd8ac64a55e89a958c0a2e383e3f0616d282eecaa01775558dd39f`
- `app/ADMIN-SERVICE-PREP.md`：`760749d04ae5230e6c6b6aaa4274bd4006faf5f4ba32ac3036352d4e1626f3a6`
- `.gitignore`：`b59c2af8b102be6e00d97efb931d0ffdfb5f6d8eda60806e224dda09d2c9c79b`

## 实现边界

### Builder Git 身份

- 常态分支要求 HEAD 只有一个 parent，commit/tree/parent 均为小写 40 位 Git object ID。
- 89 项 runtime 必须全部被当前 HEAD 跟踪，每项工作树 blob 必须等于 HEAD blob，对这些路径的 index/worktree 必须 clean。
- dirty runtime 只允许 HEAD/commit/tree/parent 精确等于 `54e694c…` legacy 锚，并完整复用 31 路径精确 overlay 状态门。
- `package.json` 必须精确包含 5 个 release/projection script，且四类依赖字段与 lock root 一致；不再从旧 commit 重构 package JSON。

### Target verifier

- 目标 stage 无需 `.git`，也不依赖编译时 commit 常量。
- 外部 manifest SHA-256 仍是必填且先校验的唯一 manifest 字节锚。
- Git 三字段仅允许小写 40 位 object ID 形状；它们同样进入 release root 重算。
- runtime / production `.next` / dependencies / Node / content root / release root 均继续从 target 实际字节完整重算，没有放宽缺失、额外、mode 或字节漂移门。

## 验证

- 聚焦 Vitest：`1 file / 2 tests PASS`，唯一一次，10.97s。
- Node 24 typecheck：PASS，唯一一次。
- 限定 5 文件 diff-check：PASS，唯一一次。

验证使用固定 Node：`[M5-HOME]/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node`，`v24.18.0`，SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。

## Post-commit 唯一验证要求

本任务禁止 stage/commit/push，因此只能在 `54e694c…` legacy 入口上执行当前三门。首个 Git 检查点提交后，必须在 **runtime 对新 HEAD 全 clean** 的状态下各执行唯一一次：

1. `src/tests/admin-release-manifest.test.ts` 聚焦 Vitest；
2. Node 24 `npm run typecheck`；
3. 本五文件白名单的 `git diff --check`。

三门 PASS 后才能在新 HEAD 重新 production build，生成全新外部 manifest SHA，并执行 target verifier。本任务的 legacy PASS、历史 manifest `d14ee6…` 和 M1 `8e70b2b7…30a` 验签均不能替代该 post-commit clean-HEAD 收据。

## 未验证与错题自检

- 本任务不 build、不 SSH/M1、不 stage/commit/push，未产生新 commit 或新 release manifest。
- 没有使用 `any` / `ts-ignore`，没有修改业务运行文件或外部 SHA/root 合同。
- 动态 Git identity 只替换 builder 的一次性 HEAD 常量；target 信任仍由外部 manifest SHA 与完整闭包重算共同约束。
- `.gitignore` 只防止未跟踪 evidence 被宽 add 纳入，没有删除本地历史证据。
