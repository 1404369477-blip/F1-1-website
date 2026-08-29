---
type: audit_report
department: 安全部
target: "TASK-20260812-E4CB53 / Release clean-only身份门"
status: final
date: 2026-08-12
related_task: TASK-20260812-E4CB53
decision: pass
severity_count: { P0: 0, P1: 0, P2: 2 }
review_mode: static_read_only_final_adversarial_review
tags: [release-identity, git, clean-head, manifest, checkpoint]
summary: "PASS；P0=0/P1=0/P2=2。四项冻结SHA全部MATCH，legacy/tooling-overlay/base-runtime常量、路径表和dirty分支已全部删除，D357B3唯一P1 CLOSED。builder只接受单parent HEAD、89项runtime定向porcelain为空、每项由HEAD跟踪且工作树blob等于HEAD。target以外部manifest SHA为先验，对Git形状与runtime/Next/deps/Node/roots按现场字节重算。放行一次精确白名单Git checkpoint；不放行build/deploy，提交后仍须clean-HEAD三门及新build/builder/verifier。"
---

# Release clean-only 身份门最终只读复审

## 1. 裁定

**PASS；P0=0，P1=0，P2=2。D357B3 唯一 P1：CLOSED。**

本轮放行一次 **精确白名单 Git checkpoint**。放行只覆盖精确 pathspec stage、cached 白名单/字节复核、commit；不包含宽范围 add、push、build、builder、target verifier、SSH、M1、prepare、load 或 cutover。

本任务严格只读：未运行测试、typecheck、项目脚本、网络、SSH，未修改候选、index、HEAD 或 refs。

## 2. 冻结 SHA

| 候选 | SHA-256 | 结果 |
|---|---|---|
| `app/src/server/admin-service/release-manifest.ts` | `075d11bca11675948bb302a957ac9e071f3e5d733d9b1752fa60297c9004581a` | MATCH |
| `app/src/tests/admin-release-manifest.test.ts` | `d510f6f4db698644b8ba7abff76bb40b30eea6dbfbe2b5587bc3149e998d2fd7` | MATCH |
| `app/ADMIN-SERVICE-PREP.md` | `c25ec670c6cf438132ba832f1895598aaca88b380865671965dc03c23016202e` | MATCH，与 FF23A7/A85BCA 现行 runbook 一致 |
| `.gitignore` | `b59c2af8b102be6e00d97efb931d0ffdfb5f6d8eda60806e224dda09d2c9c79b` | MATCH |

## 3. D357B3 P1 关闭证据

候选中已不存在：

- `ADMIN_RELEASE_LEGACY_GIT_COMMIT/TREE/PARENT`；
- `ADMIN_RELEASE_TOOLING_OVERLAY_FILES`；
- `ADMIN_RELEASE_BASE_RUNTIME_FILES`；
- `assertLegacy54eOverlay()`；
- 任何 HEAD=54e 的dirty-overlay builder分支；
- 任何 20×` M` + 11×`??` 的路径/状态形状通行证。

`resolveAdminReleaseGitIdentity()` 现只有一条成功路径：

1. `rev-list --parents -n 1 HEAD` 必须精确返回 commit + 1 parent，且两者均为小写 40hex；
2. tree 为 `commit^{tree}` 的 40hex，并重读 `HEAD` 与 commit 相同；
3. app root 的 realpath 必须等于 project root 下的 `app`；
4. 89 项 runtime 的定向 `git status --porcelain=v1 -z --untracked-files=all -- <89 exact paths>` 必须为空；
5. `ls-files --error-unmatch -- <89 exact paths>` 必须全部由 Git 跟踪；
6. 每个工作树 `hash-object` 必须与 `${commit}:${path}` 的 HEAD blob 完全相同。

因此 D357B3 的“保持 ` M`/`??` 形状替换任意 overlay 字节”反例已失效：任意 runtime 字节改变都会使定向 status 非空或工作树 blob 与 HEAD 不等，在读取 manifest runtime closure 前 fail closed。

## 4. clean-only 对抗层

### 4.1 rename / delete / staged / intent-to-add / replacement

- tracked runtime 的 modified、deleted、staged、rename 都会使定向 porcelain 非空；
- intent-to-add 的 index/worktree 形状也非空；
- 从 index 删除后放回同路径 untracked replacement，定向 porcelain 非空，且 `ls-files --error-unmatch` 不能满足跟踪门；
- 已从 HEAD 提交中删除、但工作树重放同路径文件，依然被 untracked/HEAD lookup 门拒绝。

### 4.2 submodule / 异常对象

runtime 闭包精确要求 89 个文件路径。将任一路径替换为 gitlink/submodule、目录或其他异常对象时：

- `fileRecord()` 要求 regular、non-symlink、single-link、owner-controlled、realpath exact 文件；
- HEAD blob lookup / `hash-object -- <path>` 不再是正常文件 blob 对比；
- 当前runtime路径集不含目录级模糊 pathspec。

这些状态无法成为满足 `fileRecord + tracked-at-HEAD + worktree-blob-equal`的 runtime 文件。

### 4.3 partial status / pathspec

pathspec 来自代码内的 89 个固定 `app/<runtime path>`，不接受用户参数。其中的 `[`/`]` 等字符存在 Git pathspec 特殊含义的理论面，但成功路径同时需要：

- 89 项均通过 `fileRecord()`；
- `ls-files --error-unmatch` 成功；
- 对每一个精确字符串单独执行 `${commit}:${path}` 与 `hash-object -- path` 比对。

因此即使定向 status 对少数路径有 magic 解释，也不能让任一未绑 runtime 文件跳过逐路径 HEAD blob 门。未使用用户控制 pathspec，不形成任务级 P1。

### 4.4 non-runtime dirty

非 runtime 文件 dirty 不在 89 项运行闭包内，builder 可继续。这一边界不放宽 runtime/Next/dependencies/Node 的内容根：

- runtime 只从已绑 89 项读取；
- `.next` 除9个明示排除项外按实际文件完整建 manifest；
- production dependency 由 lock root 与实际 package bytes 建根；
- Node 与 target path/SHA 单独绑定。

非 runtime 工作树变更可能影响开发流程，不能改变已建立 release content root 的字节输入。Git checkpoint 仍须使用精确白名单，以防并发部门文件被误提交。

## 5. Git identity 与自引用

commit/tree/parent 由当前 clean HEAD 动态读取，它们没有被写回 runtime 源码或要求在同一 commit 内硬编码，因此无 commit-hash 自引用固定点。

- commit 与 parent 来自同一 `rev-list --parents -n 1 HEAD` 收据；
- tree 由该 commit 的 `^{tree}` 取得；
- 读取后再用 `rev-parse --verify HEAD` 确认 HEAD 未在两次 Git 身份读之间变化；
- content root 只包含 runtime/Next/dependencies/Node，release root 再将 commit/tree/parent + content root 建根。

存在一个低级并发窗口：HEAD 读取后到 89 项状态/blob 全部建根完成前，同一工作树的受信任本地进程可改动文件。现行逻辑对每项做 HEAD blob 对比，随后 `runtimeFiles()` 再读字节，两次读之间仍非单一 FD 快照。此类同 UID 主动并发篡改与当前专用 builder 的运维边界相交，本轮评为 P2；后续可通过按 HEAD blob 直接物化 runtime stage，或将 tracked/blob/fileRecord 绑为单次 FD 身份收据再降低。

## 6. target verifier 闭包

target 无 `.git` 场景的信任链为：

1. `ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256` 必须为小写 64hex；
2. manifest 必须为 owner-only 0600、regular、single-link、realpath exact；
3. 文件 SHA 先与外部期望值精确相等；
4. Git commit/tree/parent 只接受小写 40hex；
5. Node target path/version/实际字节 SHA 重算；
6. runtime、Next、production dependencies 都从 target 实际字节重算；
7. content root 与包含 Git 三字段的 release root 重算；
8. 完整 canonical manifest 字节必须与重建对象逐字节相等。

仅替换或伪造 Git 40hex 会同时改变 release root 和 manifest SHA；若不更新两者会失败。若能更新外部先验 SHA，其信任等价于拥有该部署授权；这属于预期的外部发行锚管理边界，不是 target verifier 自身放宽。

## 7. `app/evidence/` ignore 边界

`.gitignore` 的 `app/evidence/` 精确限定在该目录。它：

- 不匹配 `app/src/**`、`app/scripts/**`、`app/migrations/**`、`app/package*.json` 或 `.env.example`；
- 不是 89 项 `ADMIN_RELEASE_RUNTIME_FILES` 的成员；
- 不是 `.next` 闭包或 production dependency 输入；
- 防止历史任务现场证据被宽范围 add 误收。

它不能用来隐藏任一已绑 runtime 文件的漂移；对 runtime 精确 path 的 Git HEAD/blob 门与 ignore 规则独立。本轮未发现过宽污染。

## 8. Findings

### P0 / P1

无。D357B3 唯一 P1 已关闭。

### P2-01：builder 的 tracked/blob 核对与 runtime 再读之间存在同 UID TOCTOU 窗口

当前逻辑依次运行 Git 状态、每文件 `hash-object`，后续由 `runtimeFiles()` 重新打开并读取文件。同 UID 主动攻击进程可在这些读之间竞态替换字节。新 manifest 会记录后读字节，且 target verifier 会要求相同，因此不存在无签名字节绕过 target 外锚；但 builder 的“当时字节等于 HEAD”证明可被本地竞态削弱。

最小加固：从 HEAD blobs 直接物化发行 runtime stage，或使用单次 FD 身份+字节读取收据来同时构建与校验。

### P2-02：非 runtime dirty 被有意忽略

这不放宽 release 闭包，但使同一工作树中其他部门或工作流变更可与 builder 并存。为避免误提交，checkpoint 必须继续使用精确 pathspec，并要求 cached 路径集合与白名单完全等集；禁止 `git add .`、`git add app`、`git add -A` 和任何目录通配。

## 9. Git checkpoint 精确放行条件

只放行一次 checkpoint，且必须全部满足：

1. 从 A7D590 原始精确白名单出发，增量加入 FF23A7/A85BCA 实际修改的 release-manifest/test/runbook 文件，并以当前冻结 SHA 为准；
2. 只用 `git add -- <exact-files...>`，禁止目录 pathspec、glob 和所有宽范围 add；
3. `git diff --cached --name-status -z` 的路径/状态必须与白名单完全等集，rename/copy/submodule 或异常状态一律拒绝；
4. 从 index blob 重算每项 SHA-256，与白名单精确一致；
5. 对 cached bytes 执行定向凭据/私钥/大文件/特殊对象检查与 `git diff --cached --check`；
6. 明确排除 `app/evidence/**`、`app/.local/**`、`app/.next/**`、`app/node_modules/**`、`scratch/**`、DB/WAL/SHM、key、plist/log 现场实体和其他部门并发变更；
7. 满足上述全部条件后才允许 commit。

本安全放行不要求在提交前运行 builder；当前 dirty 工作树运行 builder 本就应 fail closed。

## 10. Post-commit clean-HEAD 硬门

提交完成后，仍不得直接部署。必须按顺序取得：

1. 在真实新 HEAD 上确认单 parent，89/89 runtime 均 tracked，定向 status 为空，每项工作树 blob 等于 HEAD；
2. 聚焦 `admin-release-manifest.test.ts` Vitest 一次 PASS；
3. 固定 Node 24 typecheck 一次 PASS；
4. 限定 release-manifest/test/runbook/`.gitignore` 的 diff-check 一次 PASS；
5. 三门全部 PASS 后才重新 production build；
6. 从该 clean HEAD 运行 builder，生成新 manifest 和唯一外部 SHA；
7. 在 fresh stage 用该新外部 SHA 运行 target verifier，必须对 runtime/Next/deps/Node/content/release roots 完整 PASS。

只有上述硬门完成，才可另行评估新 release/stage 放行。历史 manifest、M1 旧 release 或临时 fixture PASS 均不能代替。

## 11. 错题自检

- 没有因删除 legacy 分支就忽略 D357B3 未审的 clean HEAD、target 和 ignore 层。
- 没有把测试 fixture PASS 写成实际 post-commit clean HEAD 已验证。
- 没有把非 runtime dirty 的可并存边界扩大成可宽范围提交。
- 没有把外部 manifest SHA 当作 Git 存在性证明；target 仅依赖 SHA + roots 的设计是无 `.git` stage 的明确信任边界。
- 放行只覆盖一次精确白名单 checkpoint，不包含 push、build、builder、verifier、deploy 或 M1。
- 本轮 0 测试、0 脚本、0 网络、0 SSH、0 修改。

TASK_STATE_OK
