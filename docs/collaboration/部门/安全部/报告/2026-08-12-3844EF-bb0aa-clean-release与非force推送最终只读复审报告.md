---
type: audit_report
department: 安全部
target: "TASK-20260812-3844EF / bb0aa clean release与非force推送"
status: final
date: 2026-08-12
related_task: TASK-20260812-3844EF
decision: pass
severity_count: { P0: 0, P1: 0, P2: 3 }
review_mode: static_read_only_release_and_push_final_adversarial_review
tags: [git, release-manifest, smart-http, non-force, m1-stage, prepare-gate]
summary: "PASS；P0=0/P1=0/P2=3。HEAD/tree/parent、54e→2ff→bb0两提交链、89项clean runtime、322项Next、44包依赖、固定Node与manifest全部匹配；远端目标ref仍精确54e，HTTPS remote无嵌入凭据、无pre-push hook、无force依赖。放行一次显式commit-to-ref的普通smart-HTTP非force push，须紧邻push重读远端54e，首错停止，并在push后回读目标ref精确bb0。该裁定不放行M1 fresh stage、prepare、load或cutover。"
---

# bb0aa clean release 与非 force 推送最终只读复审

## 1. 最终裁定

**PASS；P0=0，P1=0，P2=3。**

放行一次从冻结 commit 到冻结目标 ref 的普通 Git smart-HTTP 非 force push：

```text
source: bb0aa0266b73b7b2f7af38d3f29ac0a07dee772f
destination: refs/heads/codex/first-public-release
expected remote before push: 54e694c13b7369819448a2c3b072cb0fbbc49b7b
expected remote after push: bb0aa0266b73b7b2f7af38d3f29ac0a07dee772f
```

该放行只覆盖两个既有 commit 的一次非 force 传输。M1 fresh stage、prepare、LaunchAgent load、Tailscale/Passkey、DB migration、sender、公开 read-mode 与 cutover 都保持未放行。

本轮严格只读：未执行测试、typecheck、build、项目脚本、Git 写、push、SSH、DB、M1 或服务操作。为核对任务要求的 remote parent race，执行了一次 Git smart-HTTP 只读 `ls-remote`；没有网络写。

## 2. Git 身份、提交链与范围

| 检查项 | 独立回读值 | 结果 |
|---|---|---|
| HEAD | `bb0aa0266b73b7b2f7af38d3f29ac0a07dee772f` | MATCH |
| HEAD tree | `2fdf2078daf7bb2c6327d19c6c8c81809465abf2` | MATCH |
| HEAD single parent | `2ff1bdba83eadddf01908bfbc884d8efcd0d84d1` | MATCH |
| parent single parent | `54e694c13b7369819448a2c3b072cb0fbbc49b7b` | MATCH |
| branch | `codex/first-public-release` | MATCH |
| local commits after `54e` | `2` | MATCH |
| app 定向 porcelain | `0 bytes / 0 records` | PASS |
| cached diff | empty | PASS |

两提交链是唯一线性祖先关系：

1. `2ff1bdba...`，parent `54e694c...`，tree `474a260f...`，`feat: add admin review projection runtime`；
2. `bb0aa026...`，parent `2ff1bdba...`，tree `2fdf2078...`，`test: align release identity with clean head`。

`54e..bb0` 的改动集合精确为 39 路径：`.gitignore` 加 `app/**` 38 路径。第一 commit 承载 39 路径，第二 commit 只修改 `app/src/tests/admin-release-manifest.test.ts`。冻结 tree 中未发现 gitlink、submodule、symlink 或异常 tree mode；定向高置信凭据模式未命中。没有额外 tag、其他分支或第三个 commit 需要本次 push。

## 3. clean release manifest 与闭包

### 3.1 manifest 身份

| 字段 | 实值 | 结果 |
|---|---|---|
| 绝对路径 | `[M5-HOME]/Documents/F1+1/app/.local/release/admin-service-release-manifest.json` | realpath exact |
| SHA-256 | `6f4642999797aea6d220cc01ec4d9500416a37a5db7de8eaafc573991bff770d` | MATCH |
| 文件身份 | uid501 / gid20 / mode0600 / nlink1 / regular | PASS |
| 字节数 | `1,859,487` | MATCH |
| canonical 尾换行 | 1 | PASS |
| schema | `f1plus1-runtime-release-manifest-v2` | MATCH |

### 3.2 绑定内容

| 闭包 | 数量 / 根 | 结果 |
|---|---|---|
| Git | commit `bb0aa...` / tree `2fdf...` / parent `2ff1...` | MATCH |
| runtime | 89 files，全部 mode0644 | MATCH |
| Next | 322 files / 13,399,239 bytes / root `40746f5fd74751c9e1890403e7ba8e15c4b027a6cceb954bdda867ac53c1ec7c` | MATCH |
| production packages | 44 / root `517c29e4a226a5a47ccee85a5063c9ca985aff124760af936acec5c867dd2ffe` | MATCH |
| M1 Node target | `[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node` | MATCH |
| Node SHA | `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` | MATCH |
| content root | `d42c42cbccd2314ff53a012de64e7606a1872b8853a2d182c5079d3c35e5fefe` | MATCH |
| release root | `d186e4285198e78185aaa23a0c218313c78f2adf0aa5f377fbf380dc01307de1` | MATCH |

F055A6 的执行收据显示：三项重复空目录均在身份、xattr、ACL、flags、mount 与 descriptor 门后各做一次非递归 `rmdir`，当前三路径均 absent；正常 `server/app`、`server/chunks`、`static/chunks` 保持非空。随后 builder 唯一一次 PASS，闭包外 harness 的固定 Node24 `--check` 与实际 M1-target 验签各一次 PASS，`externalCalls=0`。本轮只读回读与这些冻结值一致。

### 3.3 自引用结论

没有 commit-hash 固定点自引用。manifest 是 Git ignored 的 build 输出；当前 commit、tree、parent 由 clean HEAD 动态读出，release root包含这三个字段，但 manifest 本身未进入 Git tree 或 runtime/Next/dependency content root。push 不改变 `bb0` commit 对象，故不会要求重建 manifest。

## 4. smart-HTTP、凭据与远端竞争边界

### 4.1 当前只读远端事实

- origin fetch/push URL均为 `https://github.com/1404369477-blip/F1-1-website.git`；URL中没有 userinfo、token或其他嵌入凭据。
- 目标 remote ref只读回值精确为 `54e694c13b7369819448a2c3b072cb0fbbc49b7b`。
- `main` 只读回值为 `ee450639613ffc43e7b860b3237bdde296f0416d`；本任务不得写它。
- 当前没有 branch upstream 配置；因此必须使用完整显式 refspec，不能依赖 `git push` 默认目标。
- credential helper 是系统 `osxkeychain` 加 GitHub CLI helper；进程环境中 `GITHUB_TOKEN`、`GH_TOKEN`、`GIT_ASKPASS`、`SSH_ASKPASS` 均 absent。没有 `http.*.extraheader`，没有可执行 `pre-push` hook，`core.hooksPath` 未改写。
- `GIT_TRACE`、`GIT_TRACE_CURL`、`GIT_CURL_VERBOSE` 均 absent；执行时继续保持，避免把认证交换写进终端日志。

凭据仍由本机现有 helper 在 Git transport 层提供。执行任务不得读取、打印、复制或改写凭据，不得把 token 写进命令行、remote URL、环境文件或报告。若 helper 需要交互、授权不足或身份不符，按首错停止。

### 4.2 非 force 安全语义

显式 source commit使本地工作树、index或分支在校验后的非 runtime 并发变化无法改变被传输的 source object。显式 destination限制唯一目标 ref。普通 push 的 fast-forward门会拒绝目标远端出现不在 `bb0` 祖先链上的竞争更新；禁止 `+refspec`、`--force`、`--force-with-lease`、`--mirror`、`--all`、`--tags` 与 API fallback。

若远端在紧邻 preflight 与 push 之间前移到 `2ff`，普通 push仍可 fast-forward到 `bb0`。这不会引入额外代码，但它表示预期旧值发生变化，push后仍须精确回读并保留该异常。若远端前移到无关或新后继对象，普通 push应拒绝，禁止通过 force解决。若远端已是 `bb0`，本次传输变成 no-op；应记录并停止重复 push。

## 5. 唯一执行命令与硬门

### 5.1 push 前硬门

后继执行任务必须在同一短窗口按顺序重新核对，任一首错即停：

1. `HEAD/tree/parent/parent-parent` 分别精确为 `bb0/2fdf/2ff/54e`；
2. `git rev-list --count 54e..bb0` 精确为2，且祖先关系 `54e→2ff→bb0`；
3. app定向 porcelain仍为0，cached diff仍为空；
4. manifest仍为 exact realpath、uid501、mode0600、nlink1、SHA `6f4642...770d`；
5. origin push URL逐字等于当前 HTTPS URL，无嵌入凭据；trace/curl-verbose变量仍关闭；
6. 紧邻 push 的 `ls-remote` 必须只返回一行目标 ref=`54e694c...`；`main` 可同时记录为只读对照；
7. 当前过程不存在另一在办 push，且执行者明确接受只更新目标 branch。

全部通过后只允许一次：

```text
git push --porcelain origin bb0aa0266b73b7b2f7af38d3f29ac0a07dee772f:refs/heads/codex/first-public-release
```

不用 `-u`，避免顺带写本地 upstream 配置。不得重试；认证失败、连接中断、non-fast-forward、remote rejected、hook错误或输出不符合预期均停止并转只读对账。

### 5.2 push 后硬门

1. 只读 `ls-remote --heads` 必须精确得到一行目标 ref=`bb0aa...`；
2. 本地 commit仍为 tree `2fdf...`、single parent `2ff...`，且两提交链不变；
3. `main` ref必须与push前对照一致；不得出现 tag或其他分支更新收据；
4. manifest SHA仍为 `6f4642...770d`，89/322/44与五个根不变；
5. app定向 porcelain仍为0，cached diff仍为空。

远端回读未知、ref不等于`bb0`、main变化、manifest或本地对象漂移时，本轮push收口为FAIL/Unknown；不得二次push、force、API补写或直接进入M1。

## 6. Finding

### P0 / P1

无。当前冻结链、闭包与非 force transport没有发现真实上线P0/P1。

### P2-01：Next manifest不记录空目录集合

`nextBuild.files`只绑定文件。三项重复空目录当前已精确删除，故不阻断push；未来target verifier仍无法仅凭manifest拒绝新的多余空目录。可选加固为绑定canonical目录集合或拒绝非闭包父链所需的空目录。

### P2-02：ignored manifest仍采用原位截断覆盖

`app/scripts/admin-build-release-manifest.ts:23-25` 对固定ignored路径使用 `openSync(output, "w", 0600)` 后原位写。它没有同目录临时文件、fsync与原子rename；也未在打开输出前拒绝既有symlink/hardlink/异主文件。当前实物已通过regular、single-link、realpath、0600与外部SHA验签，故本次push不受阻；后继任何builder失败或同UID本地替换后，旧路径不得被当作有效收据。最小加固是安全创建同目录0600临时regular文件、完整写入并fsync、复核目标/父链后原子替换，再fsync父目录。

### P2-03：无upstream且远端父存在TOCTOU竞争

当前branch未设置upstream，远端状态也可能在preflight后变化。显式完整refspec、紧邻远端回读、一次非 force push和push后精确回读可将竞争限制为安全拒绝或可审计的祖先链前移；该项不构成force理由。

## 7. 分层放行

| 层级 | 裁定 | 精确边界 |
|---|---|---|
| 一次普通smart-HTTP非force push | **PASS（带前后硬门）** | 只允许 `bb0→refs/heads/codex/first-public-release`；pre-ref=`54e`，post-ref=`bb0` |
| M1 fresh stage | **本任务不放行** | push成功与post门PASS后另派受控stage任务；须传输精确manifest/闭包并在M1以外部SHA实际验签 |
| prepare-only | **不放行** | C0BACB仍有capability域名、Serve login、M5/iPhone selectors、device approval、Grants、policy hash、keypair/refs等缺口 |
| load receiver/Admin | **不放行** | fresh stage、prepare、同inode迁移、listener、recovery fence、私有身份链均未动态闭合 |
| sender / public read-mode / cutover | **不放行** | generation 1、receipt/outbox、active snapshot、feed/detail、公开路由隔离及回退证据尚未形成 |

push只同步代码对象。它不会把本机ignored manifest传到GitHub，也不会在M1生成release、prepare工件或服务状态。

## 8. 失败路径

- 任一SHA、计数、根、mode、owner、link、realpath或Git祖先关系漂移：停止，不push；
- remote目标ref不再精确为`54e`：停止并重新独立裁定，不force；
- 凭据helper失败、提示身份不明、trace被开启或remote URL含秘密：停止，不替换认证通道；
- push返回non-fast-forward/rejected/连接结果未知：只读回读目标ref；结果非精确`bb0`则停止，不重试；
- post门发现main/其他ref变化、本地对象或manifest漂移：FAIL/Unknown，不进入M1；
- push成功后仍不得把它解释为fresh stage、prepare、load或cutover成功。

## 9. 错题自检

- 独立回读了HEAD/tree/parents、commit差异、manifest原始字段、权限和remote ref，没有只继承开发报告结论；
- 将远端只读状态标为时间点事实，保留preflight到push的竞争窗口；
- 使用完整commit-to-ref作为唯一建议，没有依赖未配置的upstream；
- 没有输出credential helper的秘密、真实token或认证交换；
- 没有因本地manifest验签PASS而放行M1、prepare、load或cutover；
- 没有把三项已删除空目录的缺陷升级为当前闭包P1；
- 本轮除正式报告外无任何项目改动。

TASK_STATE_OK
