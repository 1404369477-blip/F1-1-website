# M4 C 层 Node24 与 SQLite 能力预检报告

## 1. 唯一最终判定

**TASK-20260802-D27E44 最终判定：PASS（P0=0，P1=0）。**

本判定只覆盖本任务定义的 **M4 C 层本地工具链与 SQLite 能力预检**：官方
Node.js 24.18.0 字节/hash、随附 npm 11.16.0、既有 `npm ci --ignore-scripts`
收据、安装树、9 项直接依赖许可证、Node `node:sqlite` 的 WAL/FULL/事务/锁/恢复
能力，以及当前空 scaffold 的 lint/typecheck/build。它不表示 C 层业务实现、四页
UI/API、安全 deny-all、Repository、fixture seed、真实端口或完整验收已经完成。

首轮检查结论保留为 **FAIL（P0=0，P1=2，P2=1）**，随后只做最小配置修复并
重跑门槛。首轮失败历史没有被 PASS 覆盖或删除：

| 首轮发现 | 严重度 | 事实与影响 | 最小修复 | 复验 |
| --- | --- | --- | --- | --- |
| Next 误推断 workspace root | P1 | `/Users/hoyin/package-lock.json` 使 Next 首轮构建报告多 lockfile，并把上层目录推断为 root；构建虽成功，但根边界不可复现 | `next.config.ts` 用 `import.meta.url` 推导 app 配置文件所在目录，并显式写入 `turbopack.root`；未写死用户绝对路径，未删除或修改 Home lock | 两次修复后 build 均 exit 0；`inferred your workspace root` / `multiple lockfiles` 命中 0 |
| Next 自动改写 TypeScript 配置 | P1 | 首轮 build 对 `tsconfig.json` / `next-env.d.ts` 发生自动配置写入，Git 可见候选面漂移，不能作为可重复构建收据 | 对齐已安装 Next 16.2.11：`target=ES2017`、`jsx=react-jsx`、同时包含 `.next/types`/`.next/dev/types`/`*.mts`，`next-env.d.ts` 显式导入 `.next/types/routes.d.ts` | 重复 build 前后 37 文件聚合 SHA 与 status SHA 完全相同；Next 配置改写提示命中 0 |
| `tsconfig.tsbuildinfo` 未忽略 | P2 | typecheck/build 产生顶层增量缓存并显示为未跟踪候选 | `app/.gitignore` 增加 `*.tsbuildinfo` | `git check-ignore -v app/tsconfig.tsbuildinfo` 指向 `app/.gitignore`，构建状态面不再出现该文件 |

## 2. 任务、输入与边界

- 正式任务：`TASK-20260802-D27E44`《执行 M4 C 层 Node24 与 SQLite 能力预检》。
- 冻结输入：`docs/spec.md`、`ADR-M4-KICKOFF-001` accepted、
  `data/mvp-contract-v0/` v0.3、数据部 SQLite/Repository 交接蓝图、设计部四页实现
  交接清单。
- 允许范围：`app/.local` 隔离 Node 工具链、官方依赖 bootstrap 收据复核、
  Node24 `node:sqlite` 可抛弃临时探针、空 scaffold lint/typecheck/build、最小配置
  修复和本报告。
- 持续关闭：真实 provider、Base/飞书、Collector、平台、表单、AI、媒体抓取、
  外部发布、部署、付费、外发、真实凭证、生产数据库与业务实现。
- 未修改：`docs/spec.md`、accepted ADR、`data/`、`design/`、业务源码、Home 目录
  lockfile。

数据部交接要求的 `sqlite_version() >= 3.51.3`、WAL、每连接 FULL、
`busy_timeout`、`BEGIN IMMEDIATE`、`user_version`、rollback/commit、双连接竞争、
checkpoint/reopen/recovery 和临时文件清理已纳入本探针。设计部交接只作为后续 C
层实现输入；本任务没有把静态四页清单写成页面已实现。

## 3. 最小 tracked 配置修复

### 3.1 `app/next.config.ts`

通过标准 ESM 路径 API 从配置文件自身位置推导 app 根：

```ts
const appRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: appRoot
  }
};
```

该配置在任意用户名/父目录下都由 `next.config.ts` 自身定位，不依赖当前用户的绝对
路径，也不要求删除 `/Users/hoyin/package-lock.json`。

### 3.2 `app/tsconfig.json` 与 `app/next-env.d.ts`

- 保留 Next 16.2.11 建议的 `target=ES2017`；
- 将必需 JSX 模式预置为 `react-jsx`；
- include 同时覆盖 `.next/types/**/*.ts`、`.next/dev/types/**/*.ts`、
  `**/*.mts`、`**/*.ts`、`**/*.tsx`；
- `next-env.d.ts` 预置 `import "./.next/types/routes.d.ts";`。

复验 build 没有再次改写这些文件，也没有输出 TypeScript reconfigure、mandatory
change 或 suggested value 提示。

### 3.3 `app/.gitignore`

新增 `*.tsbuildinfo`。`node_modules/`、`.next/`、`.local/` 继续保持忽略；
`.env.example` 继续显式保留。没有删除既有增量缓存或构建产物。

## 4. 官方 Node/npm 与 bootstrap 收据

### 4.1 发行物与架构

| 项目 | 实测 |
| --- | --- |
| 主机 | `Darwin arm64` |
| 发行物 | `node-v24.18.0-darwin-arm64.tar.gz` |
| SHASUMS256 期望 SHA-256 | `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1` |
| 本地字节校验 | `node-v24.18.0-darwin-arm64.tar.gz: OK`，exit 0 |
| 二进制 | Mach-O 64-bit executable arm64 |
| Node | `v24.18.0` |
| npm | `11.16.0` |
| 安装边界 | `app/.local/toolchains/node-v24.18.0-darwin-arm64/`，无全局安装 |

校验命令从同一 `app/.local/toolchains/downloads/SHASUMS256.txt` 选择精确文件行，
再对下载字节执行 `shasum -a 256 -c -`。本线程验证了发行物与官方 SHASUM 行匹配；
SHASUMS 文件来自统筹线程的 nodejs.org bootstrap 交接，本线程未另做 PGP 签名验证，
该项超出任务要求的 SHA-256 门槛。

### 4.2 npm ci 复用收据与独立复核

统筹线程已使用上述精确 Node/npm 执行：

```text
npm ci --ignore-scripts --no-audit --no-fund
```

交接结果为 exit 0；`app/node_modules/` 已建立，安装前后 lock SHA 均为：

```text
de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83
```

本线程没有重复删除/安装依赖，避免把已成功 bootstrap 再次扩大为网络动作；对交接
结果做了以下独立检查：

- `npm config get registry` → `https://registry.npmjs.org/`；
- `npm config get ignore-scripts` → `true`；
- `npm config get audit` / `fund` → `false` / `false`；
- `npm ls --all --json` → exit 0，`problems=[]`；
- 构建后 lock SHA 仍为上述值；
- `node_modules/`、`.next/`、`.local/` 均由 `app/.gitignore` 命中。

本任务没有执行 `preinstall/install/postinstall/prepare` 等 lifecycle 命令。lock 中
既有 `hasInstallScript` 元数据不等同脚本已执行；no-lifecycle 证据来自明确的
`--ignore-scripts` 命令与仓库级 `ignore-scripts=true` 双门。

## 5. 安装树与直接许可证

官方 Node24 调用 `npm ls --all --json` 的结果：exit 0，递归输出节点 865，顶层
9 项精确版本全部存在，`problems=[]`。

| 直接依赖 | 期望/安装版本 | 许可证 | 判定 |
| --- | --- | --- | --- |
| `@types/node` | 24.0.0 / 24.0.0 | MIT | PASS |
| `@types/react` | 19.0.8 / 19.0.8 | MIT | PASS |
| `@types/react-dom` | 19.0.3 / 19.0.3 | MIT | PASS |
| `eslint` | 9.39.4 / 9.39.4 | MIT | PASS |
| `eslint-config-next` | 16.2.11 / 16.2.11 | MIT | PASS |
| `next` | 16.2.11 / 16.2.11 | MIT | PASS |
| `react` | 19.2.0 / 19.2.0 | MIT | PASS |
| `react-dom` | 19.2.0 / 19.2.0 | MIT | PASS |
| `typescript` | 5.9.3 / 5.9.3 | Apache-2.0 | PASS |

许可证检查只对 9 项 direct package 自带 `package.json` 做机械读取；Unknown/缺失/
禁止项为 0。它不替代未来发布前的完整传递依赖法务审计。

## 6. Node24 `node:sqlite` 能力探针

### 6.1 引擎身份与每连接参数

| 项目 | 实测 |
| --- | --- |
| Node | 24.18.0 |
| `sqlite_version()` | `3.53.1`，满足 `>=3.51.3` |
| `sqlite_source_id()` | `2026-05-05 10:34:17 c88b22011a54b4f6fbd149e9f8e4de77658ce58143a1af0e3785e4e6475127e9` |
| Connection 1 | WAL；`synchronous=2`（FULL）；`busy_timeout=250ms`；foreign_keys=1 |
| Connection 2 | WAL；`synchronous=2`（FULL）；`busy_timeout=80ms`；foreign_keys=1 |
| Reopen connection | WAL；`synchronous=2`（FULL）；`busy_timeout=250ms`；foreign_keys=1 |

### 6.2 migration、事务与双连接锁

- 以 `BEGIN IMMEDIATE` 创建 STRICT probe 表并在同一事务写
  `PRAGMA user_version=1`；提交后回读为 1。
- rollback 分支插入后回滚，重查行数为 0。
- primary commit 与 secondary commit 均在 reopen 后存在。
- Connection 1 持有 `BEGIN IMMEDIATE` writer lock 时，Connection 2 在 80ms
  `busy_timeout` 下失败为 `ERR_SQLITE_ERROR: database is locked`；实测等待
  `112.231ms`，处于探针规定的 60–2000ms 有界区间。
- 释放/回滚第一个 writer 后，第二连接可以重新取得 `BEGIN IMMEDIATE` 并提交；
  被锁事务中的行在 reopen 后不存在。

### 6.3 checkpoint、SIGKILL 与 reopen recovery

| 步骤 | 结果 |
| --- | --- |
| 首次 `PRAGMA wal_checkpoint(FULL)` | `busy=0, log=7, checkpointed=7` |
| crash 模拟 | 子进程在 FULL WAL 中 commit 后收到 `SIGKILL`，没有正常 close |
| reopen | 能读到 primary、secondary 与 SIGKILL 前已提交的三行；rollback/锁回滚行不存在 |
| `PRAGMA integrity_check` | `ok` |
| recovery checkpoint | `busy=0, log=2, checkpointed=2` |
| reopen `user_version` | 1 |
| engine/source id | reopen 前后逐字一致 |

该探针验证的是本机单文件、同机双连接与一个 SIGKILL 恢复样例；不推导网络文件
系统、多实例生产负载、RTO/RPO 或生产存储可用性。

### 6.4 权限、外联与清理

- 探针临时目录 mode：0700。
- DB、`-wal`、`-shm` mode：0600。
- 探针代码只使用 `node:sqlite`、本地文件与同一 Node 二进制子进程；
  `external_calls=0`。
- 最终关闭所有连接并删除 `app/.local/sqlite-preflight-*`；
  `temporary_files_cleaned=true`。

第一次重跑探针已走完数据库行为，但包装断言把 `node:sqlite` 返回的
null-prototype row 与普通对象直接 `deepStrictEqual`，因此包装器 exit 1。该次临时
目录也已清理。修正方式只把 row 映射成普通 `{id, marker}` 后比较，没有改变 SQL、
门槛或期望；第二次完整重跑 exit 0。第一次 exit 1 保留在本报告，未被当成 SQLite
引擎失败，也未被伪装为 PASS 收据。

## 7. lint、typecheck、build 与零漂移

所有 npm 命令均由绝对 Node24 工具链路径执行，并将该 bin 目录放在 PATH 首位；
`NEXT_TELEMETRY_DISABLED=1`。

| 命令 | Node/npm | 退出码 | 结果 |
| --- | --- | ---: | --- |
| `npm run lint` | 24.18.0 / 11.16.0 | 0 | ESLint 无错误 |
| `npm run typecheck` | 24.18.0 / 11.16.0 | 0 | `tsc --noEmit` 无错误 |
| `npm run build` | 24.18.0 / 11.16.0 | 0 | Next 16.2.11 Turbopack 编译、TypeScript、静态页生成通过 |
| 重复 `npm run build` + 机器化漂移检查 | 24.18.0 / 11.16.0 | 0 | build exit 0、37 文件及 status 完全不变、禁止 warning 命中 0 |

构建路由只包含当前空 scaffold 的 `/` 与框架 `_not-found`。这不表示 Spec 中四页
路由已实现。

### 7.1 tracked-candidate 定义

当前 worktree 尚未把新 app scaffold 全部加入 Git index；实际 index-tracked app
文件只有 `app/README.md`。若只比较 `git ls-files app` 会漏掉本节点准备提交的配置
和源码。因此本报告使用更严格的 Git-visible tracked-candidate 定义：

```text
git ls-files --cached --others --exclude-standard -- app
```

它覆盖 index 文件与所有未忽略、候选进入版本控制的 app 文件，同时排除
`node_modules/.next/.local/tsbuildinfo`。结果共 37 文件。

| 对比项 | build 前 | build 后 | 结果 |
| --- | --- | --- | --- |
| candidate count | 37 | 37 | 相同 |
| 文件内容聚合 SHA-256 | `8cc3e6622bec1bc49b543ef3585c7901746dc5cc4f7d436fcc88505401cbfa07` | `8cc3e6622bec1bc49b543ef3585c7901746dc5cc4f7d436fcc88505401cbfa07` | 相同 |
| `git status --short -- app` SHA-256 | `aa01a16b1e3e6b0e841be896650a0fc8d9b2ae7baf34a37be623dc64da3ec80d` | `aa01a16b1e3e6b0e841be896650a0fc8d9b2ae7baf34a37be623dc64da3ec80d` | 相同 |
| package-lock SHA-256 | `de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83` | 同左 | 相同 |

关键配置在复验时的 SHA-256：

- `app/next.config.ts`：`4cad194c09413d0436f990ddb4a79c886d97611a01c592fd2a43f5f0d9eae313`
- `app/tsconfig.json`：`a2ce412e4f078ee7e03aea4f7ac15270d3cb67781d9711ca35dd44e61de82da8`
- `app/next-env.d.ts`：`7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651`

重复构建输出没有出现：

- `inferred your workspace root`；
- `We detected multiple lockfiles`；
- `reconfigured your tsconfig.json`；
- `mandatory changes were made to your tsconfig.json`；
- `suggested values were added to your tsconfig.json`。

## 8. 命令与退出码总表

| 序号 | 命令/检查 | 退出码 | 说明 |
| ---: | --- | ---: | --- |
| 1 | 发行物 SHASUM 精确行 + `shasum -a 256 -c -` | 0 | `e1a97e...979ed1`，OK |
| 2 | Node/npm/平台/二进制架构检查 | 0 | v24.18.0 / 11.16.0 / Darwin arm64 |
| 3 | npm registry、ignore-scripts、audit、fund 与 lock SHA 复核 | 0 | 官方 registry；true/false/false；lock 不变 |
| 4 | `npm ci --ignore-scripts --no-audit --no-fund`（统筹交接） | 0 | 本线程复用并独立验树，不重复安装 |
| 5 | `npm ls --all --json` | 0 | `problems=[]` |
| 6 | 9 项 direct license/version 机械检查 | 0 | MIT/Apache-2.0；Unknown=0 |
| 7 | SQLite probe 第一次包装器 | 1 | null-prototype row 比较错误；DB 行为已执行，临时文件已清；收据作废 |
| 8 | SQLite probe 修正后完整重跑 | 0 | 3.53.1、WAL/FULL/锁/事务/SIGKILL/reopen/checkpoint 全通过 |
| 9 | `npm run lint` | 0 | PASS |
| 10 | `npm run typecheck` | 0 | PASS |
| 11 | `npm run build` | 0 | PASS，无 root/改写 warning |
| 12 | 重复 build + candidate hash/status/lock/warning 机器检查 | 0 | 零 Git-visible 自动漂移 |
| 13 | Git-visible app secret/runtime-egress 静态扫描 | 0 | secret=0、runtime egress import/call=0、三个 REAL_* 均 false |

另有一条早期复核组合命令在错误工作目录下使用了 `app/package-lock.json`，出现
`No such file or directory`，且因当时组合命令未启用 `set -e` 被末尾输出掩成 0。
该收据立即判作无效，没有用于结论；随后在仓库根使用 `set -e` 重跑序号 3，得到
正确 lock SHA 和真实 exit 0。本报告保留这个执行器错误，防止把伪 0 混入验收链。

## 9. 无真实外联、secret 与 lifecycle 边界

- 本任务实际允许的网络仅为统筹线程先前完成的官方 Node/npm bootstrap；本线程
  后续 npm ls、license、SQLite、lint、typecheck、build 均针对本地已安装字节。
- SQLite 探针记录 `external_calls=0`；没有 provider/Base/平台/AI/媒体/发布代码。
- Git-visible app 静态扫描 36 个非 lock 文件：secret pattern 命中 0，`src/` 与
  `scripts/` 的 fetch/HTTP/DNS/socket/WebSocket/child_process runtime 模式命中 0。
- `.env.example` 三个真实能力开关逐字为
  `REAL_FEISHU_IO=false`、`REAL_EXTERNAL_IO=false`、
  `REAL_FORM_SUBMIT=false`。
- 没有真实 `.env`、token、API key、密码、私有标识或平台响应写入报告/源码。
- 没有执行 npm lifecycle；没有调用 `dev`、`start`、真实端口、真实 Route Handler、
  provider、worker、发布或部署。

构建工具自身可能启动本地工作进程；本报告的“无真实外联”指任务没有调用真实
provider/平台/远程服务，且当前 app 运行源码不存在网络调用。它不声称已经实现并
通过 ADR R12 的完整系统级 DNS/socket/subprocess deny-all harness；该能力仍是后续
C 层安全实现/复验项。

## 10. 临时与持久本地产物

| 产物 | 状态 | 处理 |
| --- | --- | --- |
| `app/.local/toolchains/node-v24.18.0-darwin-arm64/` | 本地隔离工具链 | 保留；被 gitignore；无全局安装 |
| `app/.local/toolchains/downloads/*` | 官方发行物与 SHASUM | 保留供可复现核验；被 gitignore |
| `app/node_modules/` | ignore-scripts 安装树 | 保留供后续 C 层；被 gitignore |
| `app/.next/` | Next 构建输出 | 保留本地；被 gitignore |
| `app/tsconfig.tsbuildinfo` | TypeScript 增量缓存 | 保留本地；新增规则后被 gitignore |
| `app/.local/sqlite-preflight-*` | 两轮 SQLite 临时 DB/WAL/SHM | 两轮均已删除，最终不存在 |
| `/Users/hoyin/package-lock.json` | 用户 Home 既有 lock | 未读取内容、未修改、未删除 |

## 11. 已验证、未验证与错题自检

### 11.1 已验证

- 官方 SHASUM 行与 Node 24.18.0 Darwin arm64 发行包字节一致；随附 Node/npm 和主机
  架构匹配。
- npm ci ignore-scripts 交接、lock 不漂移、安装树无 `npm ls` problems、9 项 direct
  版本/许可证无 Unknown。
- SQLite 3.53.1 满足下限；WAL/FULL/busy timeout/foreign key、user_version、
  `BEGIN IMMEDIATE`、rollback/commit、双连接 writer lock、checkpoint、SIGKILL 后
  reopen/integrity、权限和清理全部通过。
- lint/typecheck/build 使用绝对 Node24/npm11.16 路径，均 exit 0。
- 重复 build 的 37 文件内容聚合 SHA、Git status SHA、lock SHA 完全不变；workspace
  root 与 TypeScript 自动改写 warning 均无命中。
- secret/runtime-egress 静态扫描通过，REAL_* 继续 fail closed。

### 11.2 未验证

- Repository/migration 正式实现、fixture seed、CAS/lease/outbox、schema validator、
  业务状态机与 hash round-trip 尚未实现。
- 四页 UI/API、admin session/Origin/CSRF、真实 loopback 端口、响应式、无障碍与 AT
  尚未实现/复验。
- ADR R12 的完整运行时 deny-all harness、真实外部 provider/Base/平台/AI/媒体、
  生产存储、网络文件系统、多实例、容量、RTO/RPO、部署与发布继续未验证且未授权。
- npm ci 的原始执行由统筹线程完成；本线程复用其 exit 0 交接，并以 lock/config/tree/
  build 独立复核，没有伪称第二次安装。
- SHASUMS 文件的 PGP 签名未在本线程单独验证；本任务要求的 SHA-256 字节匹配已完成。

### 11.3 错题自检

- 没有因 Home lock 造成 warning 就删除用户文件；root 修复完全位于 app 配置。
- 没有把用户名绝对路径写进 `next.config.ts`；`import.meta.url` 保持可移植。
- 没有只比较当前 index 中唯一的 `app/README.md` 就声称构建零漂移；改用 37 个
  Git-visible candidate 全集与 status 双 hash。
- 没有把 ignored `.next`、`node_modules`、`.local` 或 `tsbuildinfo` 伪装成 tracked
  业务产物。
- 没有把首次探针包装断言 exit 1 隐藏；修正只涉及 row 表示，再完整重跑。
- 没有使用错误工作目录复核命令的伪 exit 0；该收据作废并启用 `set -e` 重跑。
- 没有修改 Spec、accepted ADR、数据/设计冻结合同或业务代码；没有把 preflight PASS
  写成 C 层业务实现 PASS、生产 SQLite 结论或外部能力授权。
- 没有执行 lifecycle、真实 provider/Base/平台/AI/媒体/发布/部署。

## 12. 收口

本任务的 Node24/npm/SQLite/build 前置能力门槛全部满足，因此最终唯一判定为
**PASS**。该 PASS 允许统筹部按独立正式任务决定是否进入后续 C 层业务实现；本报告
本身不领取、不实现也不放行后续业务切片。所有真实外部能力继续关闭。

TASK_STATE_OK
