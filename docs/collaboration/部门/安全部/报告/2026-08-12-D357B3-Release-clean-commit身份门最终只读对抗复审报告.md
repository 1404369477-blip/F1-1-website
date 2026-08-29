---
type: audit_report
department: 安全部
target: "TASK-20260812-D357B3 / A66510-0E53C4 Release clean-commit 身份门"
status: final
date: 2026-08-12
related_task: TASK-20260812-D357B3
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
review_mode: static_read_only_first_failure
tags: [release-identity, git, legacy-overlay, manifest, first-failure]
summary: "FAIL；P0=0/P1=1/P2=0。四项冻结SHA全部MATCH。首个P1出现在54e legacy分支：实现只校验31个overlay的路径、数量与Git状态，没有校验任何预期blob或内容SHA；攻击者可保持同一` M`/`??`形状而替换任意overlay运行字节，然后由builder为其生成新manifest。外部manifest SHA只能绑定生成后的传输字节，不能追溯到已审核的31项候选。依首错停止，不放行Git checkpoint。"
---

# Release clean-commit 身份门最终只读对抗复审

## 1. 裁定

**FAIL；P0=0，P1=1，P2=0。**

任务要求任一 P0/P1 首错立即停止。四项冻结候选 SHA 均精确匹配后，在 legacy 54e overlay 的“精确字节”边界发现首个 P1。本轮不放行任何 Git checkpoint，也不放行 stage、commit、push、build、builder 或 target verifier。

本轮仅做静态回读与 SHA 比对；没有运行测试、typecheck、项目脚本、网络、SSH 或任何候选修改。

## 2. 冻结身份门

| 候选 | 任务固定 SHA-256 | 本轮结果 |
|---|---|---|
| `app/src/server/admin-service/release-manifest.ts` | `8ac445e74fcd209119903c0a11e7e09f562efa942f8eceb26ff4aed0bf2ec23c` | MATCH |
| `app/src/tests/admin-release-manifest.test.ts` | `c951c1d953fd8ac64a55e89a958c0a2e383e3f0616d282eecaa01775558dd39f` | MATCH |
| `app/ADMIN-SERVICE-PREP.md` | `760749d04ae5230e6c6b6aaa4274bd4006faf5f4ba32ac3036352d4e1626f3a6` | MATCH |
| `.gitignore` | `b59c2af8b102be6e00d97efb931d0ffdfb5f6d8eda60806e224dda09d2c9c79b` | MATCH |

## 3. P1-01：legacy 54e 分支没有绑定 31 项 overlay 的已审核字节

### 证据

`assertLegacy54eOverlay()` 对 58 个 base runtime 路径执行 HEAD blob 和 clean status 核对；对 31 个 overlay 只执行：

1. overlay 数量为 31、路径唯一且都在 89 项 runtime 闭包中（`release-manifest.ts:638-645`）；
2. `git status --porcelain=v1 -z --untracked-files=all` 的路径与状态严格等于固定的 20 个 ` M` + 11 个 `??`（`release-manifest.ts:646-681`）。

该函数没有对 31 项 overlay 执行任何一项已审核字节校验：

- 没有固定 path → SHA-256 map；
- 没有固定 path → Git blob map；
- 没有固定整体 patch/diff hash；
- 没有要求外部输入一个已审核 overlay 候选根。

`resolveAdminReleaseGitIdentity()` 在 HEAD/tree/parent 等于 legacy 常量时调用该函数，然后直接返回 identity（`release-manifest.ts:685-713`）。后续 `runtimeFiles()` 会计算当时工作树字节的 SHA 并把它们写入新 manifest，这一步只记录了输入，没有证明输入就是 A66510/0E53C4 审核过的精确 31 项字节。

### 可行反例

在 `HEAD=54e694c…` 不变的情况下：

1. 对任一已是 ` M` 的 overlay 文件继续替换字节，Git 状态仍为 ` M`；或替换任一 `??` 文件的内容，状态仍为 `??`；
2. 保持所有 31 个路径与状态数量不变；
3. legacy gate 仍会接纳该 overlay，builder 再为攻击后字节生成自洽 manifest 和 content/release roots。

影响包括 `admin-service/server.ts`、数据库与投影运行文件，也包括 `release-manifest.ts` 自身。因此未绑定 runtime 字节可进入新 release manifest，满足任务的 P1 定义。

### 为什么外部 manifest SHA 不能关闭该缺口

target verifier 的外部 manifest SHA 能阻止 manifest 从 builder 到 target 的传输篡改，也能让 target 重算 runtime/Next/dependency/Node/root。它的建立时间晚于 legacy overlay 输入；当 builder 已把攻击后字节合法写入 manifest 时，外部 SHA 只会锁定这份新 manifest，无法证明它源自任务固定的已审核 31 项候选。

## 4. 最小修正边界

首选的最小安全修正是 **删除一次性 legacy dirty-overlay 运行入口**，让 builder 只接受已形成、单 parent、89/89 runtime tracked，且 index/worktree/blob 均等于 HEAD 的 clean commit。该方案不需要在 `release-manifest.ts` 中硬编码它自身的 SHA，可避免自引用固定点。

后继必须严格分两步：

1. 仅根据一份经独立复核的精确 path + SHA 白名单形成首个 checkpoint，禁止在提交前运行 builder；
2. 提交后在新 clean HEAD 上重新执行聚焦测试、Node 24 typecheck、限定 diff-check，再执行 build/builder，生成新外部 manifest SHA 并执行 target verifier。

若保留 legacy 兼容分支，则必须从 builder 以外提供经独立复核的 31 项 path/status/content 根，且该外部根必须在读取 runtime 字节之前 fail closed。由于 `release-manifest.ts` 自身位于 overlay，把它自身 SHA 直接写入同一文件会产生自引用固定问题；这个保留方案的复杂度和误用面明显更高。

## 5. 分层复审状态

| 层 | 状态 | 结论 |
|---|---|---|
| 四项候选 SHA | PASS | 4/4 MATCH |
| legacy 54e 的 58 项 base | 静态设计已回读 | 有 HEAD blob + clean status 门 |
| legacy 54e 的 31 项 overlay | FAIL / P1 | 只绑 path/status，未绑已审核字节 |
| clean HEAD 的 rename/intent-to-add/submodule/partial-status/非runtime-dirty 全部对抗 | NOT_RUN（首错后停止） | 不从开发测试继承PASS |
| commit/tree/parent 动态字段与自引用 | NOT_RUN（首错后停止） | 未完成最终裁定 |
| target verifier 外部 SHA/Git形状/runtime/Next/deps/Node/roots | NOT_RUN（首错后停止） | 未完成最终裁定 |
| `app/evidence/` ignore 边界 | NOT_RUN（首错后停止） | 未完成最终裁定 |

## 6. Git checkpoint 裁定

**不放行。**

本任务的放行前提是 P0=0 且 P1=0。当前 P1=1，因此不得执行精确白名单 stage/commit/push，也不得用开发部前序聚焦测试 PASS 代替本轮安全门。修正后需新建独立安全 successor，重新从固定 SHA 门开始复审。

## 7. 未验证

- clean HEAD 对 rename、intent-to-add、submodule、partial status 与非 runtime dirty 的完整对抗；
- 动态 commit/tree/parent 是否在全链路没有自引用或信任放宽；
- target verifier 的全部目标机重算边界；
- `app/evidence/` ignore 是否存在运行闭包污染或过宽排除；
- post-commit clean-HEAD 聚焦测试、typecheck、diff-check、build/builder、新 manifest SHA 与 target verifier。

## 8. 错题自检

- 没有把“路径+状态精确”误写成“字节精确”。
- 没有把外部 manifest SHA 的传输锚语义扩大成 builder 输入来源证明。
- 首个 P1 确立后已停止，没有继续扩展对抗或运行任何测试/脚本。
- 没有修改候选、index、HEAD、refs、网络、M1 或生产状态。
- 关于 clean HEAD、target verifier 和 evidence ignore 的未完层均明确标为 NOT_RUN，没有猜测 PASS。

TASK_STATE_OK
