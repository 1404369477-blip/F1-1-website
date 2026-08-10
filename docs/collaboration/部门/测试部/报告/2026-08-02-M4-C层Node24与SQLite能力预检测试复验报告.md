---
type: audit_report
department: 测试部
target: docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md; docs/collaboration/tasks/TASK-20260802-D27E44.json; docs/decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md; app/
status: final
date: 2026-08-02
related_task: TASK-20260802-6F480F
decision: pass
tags: [M4, C层预检, Node24, node-sqlite, reproducible-build, independent-audit]
summary: 测试部在固定 Node 24.18.0、npm 11.16.0、现成 node_modules 和隔离 mktemp 目录上完成独立复验。官方归档 SHA、lock SHA、npm ls、SQLite 3.53.1 的 WAL/FULL/锁/事务/checkpoint/SIGKILL 恢复/权限/清理、lint/typecheck/build 与 Git-visible 零漂移最终全部通过，当前 P0=0、P1=0。开发首轮 FAIL、测试包装器错误、共享 node_modules 被延迟清理误删后恢复，以及无效诊断命令均保留在报告中；PASS 只覆盖本地工具链与 SQLite 能力预检，不扩展到 C 层业务实现、完整安全运行时或生产放行。
---

# M4 C 层 Node24 与 SQLite 能力预检测试复验报告

## 1. 唯一最终判定

**TASK-20260802-6F480F 最终判定：PASS（当前 P0=0，当前 P1=0）。**

本结论只覆盖当前任务规定的本地前置能力：固定 Node/npm、官方归档 SHA-256、
`package-lock.json`、现成安装树、Node `node:sqlite` 的单机双连接行为，以及当前空
scaffold 的 lint/typecheck/build 可重复性。以下范围继续保持未实现、未验证或未授权：
Repository/migration 正式实现、fixture seed、CAS/lease/outbox、四页 UI/API、admin
session/Origin/CSRF、完整 R12 deny-all harness、真实端口、真实 provider/Base/平台/AI/
媒体/发布、生产存储、部署、付费与外发。

本轮没有修改 `app/` 配置或源码、Spec、accepted ADR、`data/`、`design/`。测试部只新增
本报告，并在报告定稿后通过任务脚本更新正式 TASK/index。

## 2. 审核输入、执行身份与边界

- 正式测试任务：`TASK-20260802-6F480F`，状态在开始时为 `claimed`，授权为
  `user_confirmed`。
- 被复验开发任务：`TASK-20260802-D27E44`，开发部最终报告为 PASS，并保留首轮
  `FAIL（P0=0，P1=2，P2=1）`。
- accepted 门槛：`ADR-M4-KICKOFF-001` 的 C 轴 local preflight；SQLite WAL 多连接拒绝
 低于 3.51.3 的实际引擎，真实外部能力持续关闭。
- 固定工具链：
  `/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/`。
- 安装树：只使用统筹部恢复后的现成 `app/node_modules/`；测试部没有运行
  `npm install`、`npm ci`、全局安装或 lifecycle。
- SQLite 临时目录：每轮由 `mktemp -d /tmp/f1plus1-sqlite-review.XXXXXX` 创建，
  `umask 077`；只由 Node `fs.rmSync(tempDir,{recursive:true,force:true})` 清理明确的
  `/tmp/f1plus1-sqlite-review.*` 子目录。
- 构建日志临时目录：同样由 `mktemp -d /tmp/f1plus1-build-review.XXXXXX` 创建，
  最终由固定 Node 的 `fs.rmSync` 清理；未使用 shell `rm`。
- SQLite 有效探针只访问本地文件和同一 Node 二进制子进程，记录
  `external_calls=0`。本报告没有把整场会话写成 `external_calls=0`，原因见 8.4 的
  无效 `npm exec` 诊断事故。

## 3. Node、npm、官方归档、lock 与安装树

### 3.1 精确版本与架构

| 项目 | 独立实测 | 判定 |
| --- | --- | --- |
| Node | `v24.18.0` | PASS |
| npm | `11.16.0` | PASS |
| `process.platform` / `process.arch` | `darwin` / `arm64` | PASS |
| 二进制 | Mach-O 64-bit executable arm64 | PASS |
| `process.versions.sqlite` | `3.53.1` | 仅作引擎入口事实；SQL 内再次实测 |

使用的绝对路径：

```text
NODE=/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node
NPM=/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/npm
```

### 3.2 官方归档 SHA-256

| 项目 | 值 |
| --- | --- |
| 归档 | `node-v24.18.0-darwin-arm64.tar.gz` |
| 本地 SHASUMS 来源 | `app/.local/toolchains/downloads/SHASUMS256.txt` |
| SHASUMS 精确行 | `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1  node-v24.18.0-darwin-arm64.tar.gz` |
| 本地归档实算 SHA-256 | `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1` |
| 结果 | 精确相等，exit 0 |

本轮只读取现成官方 bootstrap 字节，没有联网重新下载；`SHASUMS256.txt` 的 PGP 签名
未独立验证，保留在未验证项。

### 3.3 lock、npm 配置与安装树

| 项目 | 独立实测 |
| --- | --- |
| `app/package-lock.json` SHA-256 | `de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83` |
| registry | `https://registry.npmjs.org/` |
| `ignore-scripts` | `true` |
| `audit` / `fund` | `false` / `false` |
| 恢复后 `npm ls --all --json` | exit 0；依赖节点 865（不含 root）；`problems=[]` |
| 9 项 direct 版本 | 与 `package.json` 精确一致 |
| 9 项 direct license | 8 项 MIT、1 项 Apache-2.0；Unknown=0 |

9 项 direct 为：`@types/node@24.0.0`、`@types/react@19.0.8`、
`@types/react-dom@19.0.3`、`eslint@9.39.4`、
`eslint-config-next@16.2.11`、`next@16.2.11`、`react@19.2.0`、
`react-dom@19.2.0`、`typescript@5.9.3`。

### 3.4 实际命令

```bash
"$NODE" --version
"$NPM" --version
"$NODE" -e 'console.log(JSON.stringify({platform:process.platform,arch:process.arch,sqlite:process.versions.sqlite}))'
file "$NODE"

rg '^e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1  node-v24\.18\.0-darwin-arm64\.tar\.gz$' \
  app/.local/toolchains/downloads/SHASUMS256.txt
shasum -a 256 app/.local/toolchains/downloads/node-v24.18.0-darwin-arm64.tar.gz
shasum -a 256 app/package-lock.json

(cd app && "$NPM" config get registry)
(cd app && "$NPM" config get ignore-scripts)
(cd app && "$NPM" config get audit)
(cd app && "$NPM" config get fund)
(cd app && "$NPM" ls --all --json) | "$NODE" '<stdin JSON parser: count dependencies and require problems=[]>'
```

上述有效命令均 exit 0。

## 4. 独立 Node24 `node:sqlite` 探针

### 4.1 探针入口与断言范围

有效完整重跑的命令形状：

```bash
set -euo pipefail
umask 077
probe_dir="$(mktemp -d /tmp/f1plus1-sqlite-review.XXXXXX)"
export F1_SQLITE_REVIEW_DIR="$probe_dir"
"$NODE" - <<'NODE'
// 仅使用 node:sqlite、node:fs、node:path、node:child_process、node:events、
// node:perf_hooks 与 node:assert；完整执行下列 SQL/断言矩阵。
NODE
test ! -e "$probe_dir"
```

SQL/行为矩阵全部在同一 stdin Node 程序中执行：

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA busy_timeout=250; -- primary/reopen
PRAGMA busy_timeout=80;  -- secondary lock probe
PRAGMA foreign_keys=ON;
SELECT sqlite_version();
SELECT sqlite_source_id();

BEGIN IMMEDIATE;
CREATE TABLE probe (... marker TEXT NOT NULL UNIQUE ...) STRICT;
PRAGMA user_version=1;
COMMIT;

BEGIN IMMEDIATE; INSERT rollback_row; ROLLBACK;
BEGIN IMMEDIATE; INSERT primary_commit; COMMIT;
BEGIN IMMEDIATE; INSERT locked_uncommitted;
-- secondary BEGIN IMMEDIATE must fail with database is locked
ROLLBACK;
-- secondary reacquires BEGIN IMMEDIATE, inserts secondary_commit, COMMIT

PRAGMA wal_checkpoint(FULL);
-- child opens the same DB, uses WAL/FULL, commits sigkill_committed,
-- emits COMMITTED, then parent sends SIGKILL
PRAGMA integrity_check;
PRAGMA wal_checkpoint(FULL);
```

程序在每个退出路径关闭连接、终止仍存活的子进程，并调用：

```js
fs.rmSync(tempDir, { recursive: true, force: true });
```

### 4.2 引擎与连接参数

| 项目 | 独立实测 | 判定 |
| --- | --- | --- |
| `sqlite_version()` | `3.53.1` | PASS，满足 `>=3.51.3` |
| `sqlite_source_id()` | `2026-05-05 10:34:17 c88b22011a54b4f6fbd149e9f8e4de77658ce58143a1af0e3785e4e6475127e9` | PASS |
| Primary | WAL、`synchronous=2`、`busy_timeout=250`、FK=1 | PASS |
| Secondary | WAL、`synchronous=2`、`busy_timeout=80`、FK=1 | PASS |
| Reopen / final reopen | WAL、`synchronous=2`、`busy_timeout=250`、FK=1 | PASS |
| `user_version` | migration 后、SIGKILL reopen 后、final reopen 均为 1 | PASS |

### 4.3 事务、锁、checkpoint 与 crash recovery

| 断言 | 独立结果 |
| --- | --- |
| rollback | `rollback_row` 回滚后数量 0；final reopen 仍不存在 |
| primary commit | final reopen 存在 |
| 双连接 writer 竞争 | Primary 持有 `BEGIN IMMEDIATE` 时，Secondary 得到 `ERR_SQLITE_ERROR: database is locked` |
| 锁等待 | `107.526ms`，位于探针的 50–2000ms 有界窗口 |
| 解锁后再次写入 | Secondary 重新取得 `BEGIN IMMEDIATE` 并提交成功 |
| 锁内未提交行 | `locked_uncommitted` 在 reopen 后不存在 |
| 首次 FULL checkpoint | `busy=0, log=7, checkpointed=7` |
| crash 子进程 | commit readiness=`COMMITTED`；exit code=`null`；signal=`SIGKILL` |
| SIGKILL 后 reopen | 精确存在 `primary_commit`、`secondary_commit`、`sigkill_committed` 三行 |
| `integrity_check` | SIGKILL reopen 与 final reopen 均为 `ok` |
| recovery FULL checkpoint | `busy=0, log=2, checkpointed=2` |
| source id | reopen 前后逐字一致 |

### 4.4 权限、外联与清理

| 项目 | 结果 |
| --- | --- |
| `mktemp` 目录 | 0700 |
| DB | 0600 |
| WAL | 0600 |
| SHM | 0600 |
| DB realpath | 位于该轮明确 `/tmp/f1plus1-sqlite-review.*` 根内 |
| 有效探针外联 | `external_calls=0` |
| 有效探针退出码 | 0 |
| Node 清理 | `temporary_files_cleaned=true` |
| shell 二次确认 | `test ! -e "$probe_dir"` 成功 |

## 5. lint、typecheck、build 与零漂移

### 5.1 最终有效命令

恢复后的现成依赖树上，仅运行：

```bash
export PATH="/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
export NPM_CONFIG_CACHE="$(mktemp -d /tmp/f1plus1-build-review.XXXXXX)/npm-cache"
(cd app && "$NPM" run lint)
(cd app && "$NPM" run typecheck)
(cd app && "$NPM" run build)
```

临时 npm cache 只承载本轮日志，最终由固定 Node `fs.rmSync` 清理。没有运行安装、
依赖更新或 lifecycle。

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run lint` | 0 | ESLint 无错误 |
| `npm run typecheck` | 0 | `tsc --noEmit` 无错误 |
| `npm run build` | 0 | Next 16.2.11 Turbopack 编译、TypeScript、3/3 静态页生成完成 |

构建路由仍只有 `/` 与框架 `_not-found`。该事实符合空 scaffold 预检范围，不能作为四页
UI/API 已实现的证据。npm 输出一次 11.16.0 → 12.0.2 的升级 notice，本轮没有执行升级。

### 5.2 Git-visible candidate 定义与算法

当前 app scaffold 大部分尚未进入 index，故使用任务指定的全集：

```bash
git ls-files --cached --others --exclude-standard -- app
```

开发报告兼容的内容聚合命令：

```bash
git ls-files --cached --others --exclude-standard -- app \
  | LC_ALL=C sort \
  | while IFS= read -r review_file; do shasum -a 256 "$review_file"; done \
  | shasum -a 256
```

此外，本轮用固定 Node 对每个候选执行 `relative_path + NUL + file_bytes + NUL` 聚合，
并分别对 11 个配置文件与 25 个 `src/scripts/migrations/fixtures` 文件分桶，避免只看
一个总 hash 时漏掉范围定义错误。

### 5.3 构建前后证据

| 对比项 | 构建前 | 构建后 | 结果 |
| --- | --- | --- | --- |
| candidate count | 37 | 37 | 相同 |
| candidate list SHA-256 | `6d06feae41cbb62c6946b7e50c4306a7244b4d97e9f33956dd81ab7715ef76e2` | 同左 | 相同 |
| 开发报告兼容聚合 SHA-256 | `8cc3e6622bec1bc49b543ef3585c7901746dc5cc4f7d436fcc88505401cbfa07` | 同左 | 相同 |
| path+NUL+bytes 聚合 SHA-256 | `a581daf043a94000651774f72371000e84687975f14536891dab6839a80f3b34` | 同左 | 相同 |
| 11 配置文件聚合 SHA-256 | `dbf9b08f0bdb4c5697957a744201fec293b151a430f72b47efe7ba60963e94b2` | 同左 | 相同 |
| 25 源码/脚本/fixture/migration 聚合 SHA-256 | `546f649ba70005709cc6ad443e4e8be8b0b4621c992f9612b33518c064515476` | 同左 | 相同 |
| `git status --short -- app` bytes / SHA-256 | `302` / `aa01a16b1e3e6b0e841be896650a0fc8d9b2ae7baf34a37be623dc64da3ec80d` | 同左 | 相同 |
| package-lock SHA-256 | `de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83` | 同左 | 相同 |
| `next.config.ts` | `4cad194c09413d0436f990ddb4a79c886d97611a01c592fd2a43f5f0d9eae313` | 同左 | 相同 |
| `tsconfig.json` | `a2ce412e4f078ee7e03aea4f7ac15270d3cb67781d9711ca35dd44e61de82da8` | 同左 | 相同 |
| `next-env.d.ts` | `7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651` | 同左 | 相同 |

### 5.4 禁止 warning 扫描

最终 build 日志逐项计数：

```json
{
  "workspace_root": 0,
  "multiple_lockfiles": 0,
  "tsconfig_reconfigured": 0,
  "tsconfig_mandatory": 0,
  "tsconfig_suggested": 0,
  "total": 0
}
```

因此 `workspace-root warning=0`、多 lockfile warning=0、tsconfig 自动改写 warning=0。

## 6. P0 / P1 判定

### 6.1 当前开放问题

| 严重度 | 数量 | 判定 |
| --- | ---: | --- |
| P0 | 0 | 未发现会导致错误数据库路线、数据破坏或越权放行的开放阻断 |
| P1 | 0 | 固定版本、SQLite 核心语义、安装树、构建与零漂移最终均有有效独立收据 |

### 6.2 已闭合但必须保留的历史问题

| 历史项 | 当时结果 | 当前状态 |
| --- | --- | --- |
| 开发首轮 Next workspace root / multiple lockfile | P1，FAIL 历史 | `turbopack.root` 可移植配置后 warning=0；本轮再次验证 |
| 开发首轮 tsconfig/next-env 自动改写 | P1，FAIL 历史 | 本轮 build 前后关键配置 hash 不变，rewrite warning=0 |
| 开发首轮 `tsconfig.tsbuildinfo` 未忽略 | P2，FAIL 历史 | 已被 `.gitignore` 覆盖，不进入 37 candidate/status 漂移 |
| 开发 SQLite null-prototype row 包装断言 | 包装器 exit 1 | 开发报告已保留，修正表示层后重跑；本轮使用普通 row 映射独立验证 |
| 开发错误 workdir 组合命令伪 0 | 收据作废 | 开发报告已保留；本轮所有关键命令启用 `set -euo pipefail` 或显式检查退出码 |
| 本轮 SQLite crash-child readiness 字符串过度转义 | 测试包装器 exit 1 | 该轮 Node `finally` 清理成功，`/tmp` 遗留=0；只修正 readiness 换行，原 SQL/阈值不变，完整重跑 exit 0 |
| 本轮首次 build harness 把 `-z` 放在 pathspec 后且 npm cwd 错误 | 测试器 exit 1，收据作废 | app candidate/status 未漂移；更正参数顺序与 cwd 后重新从基线运行 |
| 共享 `node_modules` 被延迟失败清理误删 | lint/typecheck/build 一度均 exit 127 | 统筹部回报根因来自开发旧失败清理命令延迟恢复；统筹按固定 Node/npm、官方 registry、ignore-scripts/no-audit/no-fund 恢复。测试部未执行恢复安装，随后独立 npm ls 与完整 build 全部 PASS |

这些历史项没有从报告中删除，也没有被改写成“首轮即通过”。当前 P0/P1 计数只表示
最终有效复验后仍开放的问题数量。

## 7. 命令与退出码总表

| 序号 | 命令/检查 | 退出码 | 收据状态 |
| ---: | --- | ---: | --- |
| 1 | 固定 Node/npm/平台/架构 | 0 | 有效 PASS |
| 2 | SHASUMS 精确行 + archive `shasum -a 256` | 0 | 有效 PASS |
| 3 | package-lock SHA | 0 | 有效 PASS |
| 4 | npm registry/ignore-scripts/audit/fund | 0 | 有效 PASS |
| 5 | 初始现成树 `npm ls --all --json` | 0 | 有效，但随后共享树被并发误删；历史保留 |
| 6 | 9 direct 版本/license | 0 | 有效 PASS |
| 7 | SQLite readiness 过度转义首轮 | 1 | 无效测试器收据；临时目录已清 |
| 8 | SQLite 修正包装器后的原门槛完整重跑 | 0 | 有效 PASS |
| 9 | 错 cwd/错 `git -z` 的 build harness | 1 | 无效测试器收据 |
| 10 | 依赖树并发缺失期间 lint/typecheck/build | 127 / 127 / 127 | 环境瞬时 FAIL；app 零漂移；依赖恢复后作废 |
| 11 | 恢复后 `npm ls --all --json` | 0 | 有效 PASS；865 nodes，problems=[] |
| 12 | 恢复后 `npm run lint` | 0 | 有效 PASS |
| 13 | 恢复后 `npm run typecheck` | 0 | 有效 PASS |
| 14 | 恢复后 `npm run build` | 0 | 有效 PASS |
| 15 | 37 candidate/config/source/status/lock 前后 hash | 0 | 有效 PASS，全部相等 |
| 16 | workspace-root/multiple-lock/tsconfig warning 扫描 | 0 | 有效 PASS，total=0 |
| 17 | `/tmp` SQLite/build 临时目录 Node 清理确认 | 0 | 有效 PASS |

## 8. 执行事故、证据边界与不确定性

### 8.1 共享依赖树并发误删

测试部早期已观测 `app/node_modules/` 存在，并独立完成 `npm ls`。随后目录整体消失，
lint/typecheck/build 得到 127；candidate/status/lock/关键配置在失败前后仍完全一致。统筹部
随后回报根因：开发部旧失败清理命令延迟恢复，误删已重建 `node_modules`；该线程已结束。
统筹部重新用精确 Node24/npm11.16、官方 registry、
`--ignore-scripts --no-audit --no-fund` 恢复，收据为 exit 0、`added 343 in 10s`。

测试部没有重复执行安装或清理，也没有把统筹恢复收据直接当作测试结论；恢复后重新
核对 npm ls、三个命令、warning 与全部零漂移证据。

### 8.2 本轮 SQLite 首次包装器错误

首轮 crash child 实际提交后，测试器使用 `String.raw` 时把换行过度转义，parent 等待
真实换行而超时，exit 1。Node `finally` 仍发送 SIGKILL、关闭连接并对明确 mktemp 目录
执行 `fs.rmSync`；随后只读扫描确认 `/tmp/f1plus1-sqlite-review.*` 遗留为 0。修正只涉及
readiness 字符串构造，SQL、阈值、权限和期望行均未改变；第二轮从新 mktemp 目录完整
重跑 exit 0。

### 8.3 本轮 build harness 首次错误

首次 harness 把 `git ls-files` 的 `-z` 写在 `-- app` 之后，并在仓库根调用 npm scripts，
因此 candidate parser 与 npm cwd 均错误。该收据整体作废。第二轮已修正范围，但正逢
共享 `node_modules` 被误删，三个命令 exit 127。统筹恢复后，第三轮从全新 baseline
完整执行并通过。

### 8.4 无效 `npm exec` 诊断事故

确认依赖树缺失时，测试执行器误运行：

```bash
/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/npm \
  --prefix app exec -- which eslint
```

npm 把 `which` 解释为缺失包，输出 `The following package was not found and will be
installed: which@6.0.1`，命令 exit 1；它没有恢复或改动 `app/node_modules`，app 的
candidate/status/lock 均保持不变。该命令可能访问 registry 或写用户 npm cache，因此
本报告明确拒绝将其纳入“无网络”或有效验收收据，也不宣称整场测试会话
`external_calls=0`。发现后立即停止该路径；最终有效 npm ls/lint/typecheck/build 只读
使用统筹恢复后的现成树，临时 npm cache 位于明确 `/tmp` 并由 Node 清理。

该执行器事故已透明保留。它没有改变被测 app 字节，最终有效门槛从恢复后的干净基线
重跑；因此当前目标 P1=0。若需要证明整场测试进程级网络包为 0，应另起带网络审计的
新任务，本报告不作该推断。

## 9. 已验证与未验证

### 9.1 已验证

- 固定 Node24/npm11.16 的版本、架构和本地二进制入口。
- 本地 SHASUMS 精确行与归档字节 SHA-256 相等。
- lock SHA、npm 配置、恢复后的完整安装树、direct 版本/许可证。
- SQLite 3.53.1 与完整 source id；WAL/FULL/busy timeout/user_version、
  `BEGIN IMMEDIATE` 双连接竞争、rollback/commit、checkpoint、SIGKILL、reopen、
  integrity、权限与清理。
- 恢复后 lint/typecheck/build 均 exit 0。
- 37 个 Git-visible candidates、11 配置、25 源码/脚本/fixture/migration、status、
  lock 与关键 Next/TS 配置构建前后零漂移。
- workspace root、多 lockfile、tsconfig rewrite warning 全部为 0。

### 9.2 未验证

- SHASUMS 文件的 PGP 签名；本任务只要求并完成 SHA-256 字节匹配。
- 统筹恢复 `npm ci` 的原始进程级 lifecycle/网络抓包；测试部只独立验证恢复后的
  `ignore-scripts=true`、tree、lock 与 build。统筹收据明确使用 `--ignore-scripts`。
- 本轮无效 `npm exec` 是否实际发出 registry 数据包；npm warning 已足以让该命令退出
  有效证据链，故没有把整场会话写成零外联。
- SQLite 网络文件系统、多实例生产并发、容量、RTO/RPO 或生产存储适用性。
- Repository/migration 正式代码、fixture、CAS/lease/outbox、schema validator、状态机、
  hash round-trip、页面/API、admin 安全、完整 deny-all、无障碍 AT 与真实端口。
- 任何真实 provider、Base、Collector、平台、AI、媒体、发布、部署、付费或外发能力。

## 10. 错题自检

- 没有采信开发部“已通过”的转述；Node/npm、SHA、tree、SQLite 与 build 均由测试部
  亲自运行有效复验。
- 没有删除、修改或重建共享 `app/.local`、`node_modules`、Home lock、Spec、accepted
  ADR、data、design、app 配置或业务源码。
- 没有用 `git ls-files app` 的单一 tracked README 冒充完整范围；使用任务指定的
  `--cached --others --exclude-standard` 37 文件全集。
- 没有隐藏开发首轮 FAIL、本轮测试器错误、并发依赖误删或无效 `npm exec` 事故。
- 没有把被锁连接的预期失败计为引擎失败；断言同时要求错误类型、错误信息、有限等待
  和解锁后重新提交成功。
- 没有只验证 crash 前 commit；实际发送 SIGKILL，并两次 reopen 核对行、
  `user_version`、source id、checkpoint 与 integrity。
- 没有使用 shell `rm` 清理临时文件；Node 只删除已验证前缀的明确 mktemp 子目录。
- 没有把 SQLite 探针的 `external_calls=0` 扩写到存在无效 npm 诊断事故的整场会话。
- 没有把本地 preflight PASS 写成 C 层业务实现、完整 R12、安全审计、生产数据库、
  外部能力或用户放行。

## 11. 收口

恢复后的最终有效收据满足任务全部技术门槛：Node/npm/官方归档/lock/tree 正确，SQLite
核心能力与清理通过，lint/typecheck/build 通过，Git-visible candidate 与关键配置零漂移，
禁止 warning 为 0。因此本任务唯一最终判定为 **PASS（当前 P0=0，当前 P1=0）**。

该 PASS 只允许统筹部决定是否派发后续独立 C 层业务实现任务；它本身不实现、不放行、
不部署、不外发，也不启用任何真实外部能力。

TASK_STATE_OK
