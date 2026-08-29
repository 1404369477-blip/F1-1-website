---
type: audit_report
department: 安全部
status: final
date: 2026-08-02
related_task: TASK-20260802-7BFD99
domain_stage: M4-C-local-runtime-capability-preflight-review
execution_mode: local_read_only_and_ephemeral
decision: pass
target: TASK-20260802-D27E44; app local Node24 archive/toolchain; package-lock and installed tree; Next/TypeScript config; Git-visible app candidates; env/source/scripts security boundary
tags: [M4, C层, Node24, SQLite, package-lock, ignore-scripts, license, build, no-egress, secret, audit]
summary: "M4 C 层安全复验 PASS：当前 P0=0、P1=0。本地 Node 24.18.0 Darwin arm64 归档 SHA/架构/隔离路径、lock 官方 registry 与 integrity、ignore-scripts、9 项 direct license、fail-closed env、可移植 Next root、忽略边界及恢复后两次构建零 Git-visible 漂移均独立通过。开发部首轮 P1/P2 与本轮延迟清理误删 node_modules 的并发失败历史已保留；安装树恢复后全套门槛重跑通过。本 PASS 只覆盖 C 层工具链/能力预检，不扩展到业务实现、完整 R12 deny-all、真实 provider 或部署授权。"
---

# M4 C 层 Node24 与 SQLite 能力预检安全复验

## 1. 唯一最终判定

**TASK-20260802-7BFD99 最终判定：PASS（P0=0，P1=0）。**

| 当前级别 | 数量 | 判定 |
| --- | ---: | --- |
| P0 | 0 | 未发现 secret、非官方 lock 来源、完整性缺失、真实外联/发布开关、Home 追踪或隔离越界。 |
| P1 | 0 | 安装树、direct license、Next root、重复 build 和 Git-visible 零漂移在并发干扰结束后全部复验通过。 |
| 总判定 | **PASS** | 满足本 TASK 的本地 C 层工具链/能力预检安全出口。 |

本 PASS 仅支持统筹部决定是否另行派发 C 层业务实现。Repository/migration 正式实现、fixture seed、CAS/lease/outbox、四页 UI/API、admin session/Origin/CSRF、完整 R12 deny-all harness、真实 provider/Base/平台/AI/媒体/发布/部署仍处于未验证或未授权状态。

## 2. 范围、输入与执行边界

本轮已完整读取并按以下权威层级复验：

1. `AGENTS.md`、`docs/agent-guide.md`、`agent-team` Skill 与安全部四文档；
2. `TASK-20260802-7BFD99` 与已完成的开发部 `TASK-20260802-D27E44`；
3. 开发部《M4 C 层 Node24 与 SQLite 能力预检报告》；
4. `ADR-M4-KICKOFF-001` accepted 的 R1–R13、A/B/C 门槛、环境变量与本地命令合同；
5. 当前 `app/` Git-visible 候选、忽略树、`app/.local` 隔离工具链与已有 `node_modules` 安装树。

执行中没有联网下载，没有由安全复验执行 `npm install`/`npm ci`/依赖重建，没有运行安装 lifecycle，没有访问真实 provider、Base、平台、AI、媒体、发布或部署端点。lint/typecheck/build 直接由隔离 Node24 调用已安装本地二进制，避免触发 npm `pre*`/`post*` 脚本路径。SQLite 本轮只做 `:memory:` 引擎身份复核，没有创建数据库文件。

## 3. 官方 Node24 归档、架构与隔离路径

| 检查 | 独立实测 | 退出码 |
| --- | --- | ---: |
| 主机 | `Darwin arm64` | 0 |
| 精确归档 | `node-v24.18.0-darwin-arm64.tar.gz` | 0 |
| `SHASUMS256.txt` 精确文件行 | 唯一 1 行；期望 SHA-256 `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1` | 0 |
| `shasum -a 256 -c -` | `node-v24.18.0-darwin-arm64.tar.gz: OK` | 0 |
| 归档实测 SHA-256 | `e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1` | 0 |
| `SHASUMS256.txt` 本地 SHA-256 | `3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469` | 0 |
| Node 二进制 | `Mach-O 64-bit executable arm64` | 0 |
| 运行时 | Node `v24.18.0`，npm `11.16.0`，`process.platform/process.arch=darwin arm64` | 0 |
| 隔离路径 | `app/.local/toolchains/node-v24.18.0-darwin-arm64/`；archive 与 binary `realpath` 均在 `app/.local/` 内 | 0 |

本地字节与给定 SHASUM 文件的字节匹配已独立证明。`SHASUMS256.txt` 的官方来源引用上游 bootstrap 收据；由于本 TASK 明确禁止联网，本轮没有再次从 `nodejs.org` 下载，也没有独立 PGP 签名核验。该限制不改变本任务规定的 SHA-256 门槛结果。

## 4. lock、registry、integrity、安装树与 license

### 4.1 lock 和 registry/integrity

| 检查 | 结果 | 退出码 |
| --- | --- | ---: |
| `app/package-lock.json` SHA-256 | `de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83` | 0 |
| lockfileVersion | 3 | 0 |
| 非根 package 条目 | 399 | 0 |
| `resolved` | 399/399 以 `https://registry.npmjs.org/` 开头 | 0 |
| `integrity` | 399/399 为 `sha512-*` | 0 |
| package/lock/installed direct 版本 | 9/9 精确相等，mismatch=0 | 0 |
| npm project config（`NPM_CONFIG_USERCONFIG=/dev/null`） | registry=`https://registry.npmjs.org/`，ignore-scripts=`true`，audit=`false`，fund=`false` | 0 |
| 恢复后 `npm ls --all --json` | `problems=[]` | 0 |
| 安装树 lock SHA-256 | `app/node_modules/.package-lock.json` = `0f2cfe60597987ef52750909f78ad74f46db5cb66db2361820d09f3fdd03dc73` | 0 |

lock 中 `hasInstallScript=true` 仅有 `sharp@0.34.5` 与 `unrs-resolver@1.12.2`。它们是 package metadata，本轮没有把 metadata 推导为已执行。仓库 `.npmrc` 与恢复命令同时强制 ignore-scripts；根 `package.json` 没有 `preinstall/install/postinstall/prepare/prebuild/postbuild` 脚本。安全复验本身没有执行安装命令或 lifecycle。

### 4.2 direct dependency 版本与许可证

| direct dependency | installed | license |
| --- | ---: | --- |
| `@types/node` | 24.0.0 | MIT |
| `@types/react` | 19.0.8 | MIT |
| `@types/react-dom` | 19.0.3 | MIT |
| `eslint` | 9.39.4 | MIT |
| `eslint-config-next` | 16.2.11 | MIT |
| `next` | 16.2.11 | MIT |
| `react` | 19.2.0 | MIT |
| `react-dom` | 19.2.0 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

direct count=9，Unknown=0，未出现本节范围内的禁止或缺失许可证。该检查只覆盖 direct package 自带 metadata，未替代发布前的完整传递依赖法务/SBOM 审计。

## 5. 安全默认、secret、代理和真实能力开关

本轮对 `.env.example`、`.npmrc`、`package.json`、Next/ESLint/TypeScript 配置、`app/scripts/` 与 `app/src/` 共 30 个文件执行了结构化和静态模式复核，退出码 0：

- `.env.example` 共 16 个 canonical key，与 accepted ADR 值对象逐项相等；
- `REAL_FEISHU_IO=false`、`REAL_EXTERNAL_IO=false`、`REAL_FORM_SUBMIT=false` 三项逐字匹配，没有额外 `REAL_*`；
- provider/adapter/summary/media/publish 仍为 `fixture/mock/fixture/fixture/manual_only`；
- secret pattern 命中 0；真实 `.env`、token、password、API key、private key 命中 0；
- `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`/`ALL_PROXY`、`NODE_TLS_REJECT_UNAUTHORIZED`、`rejectUnauthorized:false`、`strict-ssl=false` 等代理或 TLS 绕过配置命中 0；
- `fetch`、HTTP/HTTPS/DNS/raw socket/WebSocket/child_process 运行调用命中 0；
- `base_direct`、`base_snapshot`、真实平台/provider 变量、`AUTO_PUBLISH` 或非 `manual_only` 发布开关命中 0。

这是当前空 scaffold 的静态证据。R1 未知 env fail-closed parser、R12 DNS/socket/subprocess/proxy 完整 deny-all harness 和 redacted security event 还没有业务实现，本报告不把“当前没有外联代码”扩展为“R12 已完整验收”。

## 6. Next root、TypeScript 配置与 Home 边界

### 6.1 配置复验

| 文件/检查 | 当前 SHA-256 或结果 | 判定 |
| --- | --- | --- |
| `app/next.config.ts` | `4cad194c09413d0436f990ddb4a79c886d97611a01c592fd2a43f5f0d9eae313` | `dirname(fileURLToPath(import.meta.url))` 推导配置所在 app root；无 `/Users/...` 字面量 |
| 动态导入 `next.config.ts` | `turbopack.root=[M5-HOME]/Documents/F1+1/app` | 与 `realpath(app)` 精确相等，退出码 0 |
| `app/tsconfig.json` | `a2ce412e4f078ee7e03aea4f7ac15270d3cb67781d9711ca35dd44e61de82da8` | `target=ES2017`、`jsx=react-jsx`、`.next/types`、`.next/dev/types`、`*.mts` 已预置 |
| `app/next-env.d.ts` | `7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651` | 显式导入 `./.next/types/routes.d.ts` |
| `app/.gitignore` | `.local/`、`node_modules/`、`.next/`、`*.tsbuildinfo` 全部命中 | 退出码 0 |

### 6.2 Git 及 Home lock 边界

- `git ls-files` 中 `.local/node_modules/.next/tsbuildinfo` 禁止路径数为 0；
- `git ls-files --cached --others --exclude-standard -- app` 只返回 37 个仓内候选，全部 `realpath` 位于仓库根内，symlink=0；
- Git-visible lockfile 只有 `app/package-lock.json`；
- `[M5-HOME]/package-lock.json` 位于仓库根之外，不在 Git-visible 候选集，Next 的显式 app root 也没有再输出 workspace-root/multiple-lock 警告；
- 本安全复验没有发出读取其内容、修改或删除 Home lock 的命令，也没有触碰用户 Home 文件。npm config 复核显式使用 `NPM_CONFIG_USERCONFIG=/dev/null`，不依赖 Home `.npmrc`。

本轮没有进行系统调用级跟踪，因此不声称可证明 Next 内部从未对任何父路径做过 metadata 查询。可验证边界是：配置 root 精确固定为 app、禁止警告为 0、没有 Home 路径进入候选或发生内容/状态漂移。

## 7. lint/typecheck/重复 build 与零漂移

所有命令均使用绝对 Node24 二进制、本地 `node_modules`、`NEXT_TELEMETRY_DISABLED=1`、`CI=1`；本轮没有启动 dev server 或真实端口。

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node node_modules/eslint/bin/eslint.js .` | 0 | lint PASS |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 | typecheck PASS |
| 恢复后第 1 次 `node node_modules/next/dist/bin/next build` | 0 | Next 16.2.11/Turbopack PASS |
| 恢复后第 2 次同命令 | 0 | Next 16.2.11/Turbopack PASS |
| 两次构建禁止 warning 聚合扫描 | 0 | 每次命中数均为 0 |

禁止 warning 模式包括：`inferred your workspace root`、`We detected multiple lockfiles`、`reconfigured your tsconfig.json`、`mandatory changes were made to your tsconfig.json`、`suggested values were added to your tsconfig.json`。

### 7.1 并发恢复后的前/后状态

| 状态面 | build 前 | build 1 后 | build 2 后 |
| --- | --- | --- | --- |
| Git-visible candidate count | 37 | 37 | 37 |
| 独立 `path\0+bytes\0` 聚合 SHA-256 | `16c114b88090aecbcec54018a278c3b6458b70876f04f00239d5b15022b66b41` | 同左 | 同左 |
| 开发报告排序 `shasum` 行聚合 SHA-256 | `8cc3e6622bec1bc49b543ef3585c7901746dc5cc4f7d436fcc88505401cbfa07` | 同一文件集，结果未变 | 同一文件集，结果未变 |
| `git status --short -- app` SHA-256 | `aa01a16b1e3e6b0e841be896650a0fc8d9b2ae7baf34a37be623dc64da3ec80d` | 同左 | 同左 |
| `app/package-lock.json` SHA-256 | `de0eb658c3e407b17d6c94466f4766a343997b7e11d88e60c52d2dccd8544b83` | 同左 | 同左 |
| `node_modules/.package-lock.json` SHA-256 | `0f2cfe60597987ef52750909f78ad74f46db5cb66db2361820d09f3fdd03dc73` | 同左 | 同左 |
| `next/package.json` SHA-256 | `a3e5748a888e72375ca43eb6ceaf7f76aeecea41afe4d51717ba33730c93ed79` | 同左 | 同左 |
| next/tsconfig/next-env 三个 SHA | 精确固定 | 同左 | 同左 |

当前安装树和 Git-visible 状态在两次构建全过程中稳定，没有发生 lock、配置、源码、状态或安装树指纹漂移。

## 8. SQLite 身份与上游能力收据边界

本轮使用 Node24 `node:sqlite` 和 `:memory:` 执行了独立引擎身份查询，退出码 0：

```text
Node=24.18.0
sqlite_version()=3.53.1
sqlite_source_id()=2026-05-05 10:34:17 c88b22011a54b4f6fbd149e9f8e4de77658ce58143a1af0e3785e4e6475127e9
storage=:memory:
external_calls=0
```

该结果独立确认了开发报告中的 Node/SQLite 引擎身份与 `>=3.51.3` 下限。WAL/FULL、双连接写锁、rollback/commit、`user_version`、checkpoint、SIGKILL/reopen、权限和临时文件清理的完整功能探针由开发部 D27E44 报告保存；本安全 TASK 按验收出口聚焦供应链、路径、lifecycle、secret/egress 与构建洁净性，没有重复执行那套长时 SQLite 故障/恢复探针。

## 9. 保留的失败与修复历史

### 9.1 开发部首轮 P1/P2

开发部 D27E44 的首轮结论继续保留为 **FAIL（P0=0，P1=2，P2=1）**：

| 历史发现 | 原级别 | 当前复验 |
| --- | --- | --- |
| Home 上层 lock 使 Next 误推断 workspace root | P1 | `import.meta.url` 可移植 app root 已固定，两次 build 相关 warning=0 |
| Next 首轮自动改写 `tsconfig.json`/`next-env.d.ts` | P1 | 建议值已预置，两次 build 配置和候选集零漂移 |
| `tsconfig.tsbuildinfo` 当时未忽略 | P2 | `*.tsbuildinfo` 已命中 `.gitignore`，禁止 tracked count=0 |

当前没有残留 P0/P1；本 PASS 没有删除或覆写上述首轮历史。

### 9.2 本轮共享安装树并发干扰

本轮初次重复 build 时，第 1 次 exit 0，第 2 次 exit 1，错误为 Turbopack 找不到 `next/dist/.../vendored/contexts`。紧接的只读检查确认 `app/node_modules` 整体在两次命令之间消失。本安全复验和并行测试复验均没有执行删除、安装或重建。

统筹部随后在本轮协作消息中定位为：开发部正式线程的旧失败清理命令延迟恢复，误删已重建的 `node_modules`；该线程已结束并明确停止。统筹部使用精确 Node24/npm11.16、官方 registry 和 `--ignore-scripts --no-audit --no-fund` 恢复安装树，提供 exit 0、`added 343 in 10s` 收据。

安全复验没有采用干扰期的 exit 1 作为应用缺陷或 PASS 证据。恢复后已独立重跑 npm ls、direct license、lint、typecheck、两次 build、安装树/Git-visible 前后指纹和 warning 扫描，全部 exit 0 且零漂移。因此该事件保留为已关闭的取证并发失败历史，当前 P1 计数为 0。

### 9.3 安全复验的无效组合命令

一条 Git ignore/Home 边界组合命令曾在 zsh 中使用变量名 `path`，覆盖 zsh 的 PATH 数组后令后续 `git` 返回 exit 127。该命令已立即作废，没有修改文件；改用 `item` 后以 `set -e` 完整重跑，退出码 0。本报告仅使用重跑收据作为结论证据。

## 10. 关键命令/收据总表

| # | 命令或机械断言 | 退出码 | 结果 |
| ---: | --- | ---: | --- |
| 1 | 精确 SHASUM 行 + `shasum -a 256 -c -` | 0 | Node24 归档 OK |
| 2 | `file`、Node/npm version、platform/arch、`.local` realpath 断言 | 0 | Darwin arm64，v24.18.0/11.16.0，隔离 PASS |
| 3 | lock JSON 结构化扫描 | 0 | v3，399/399 registry，399/399 sha512，direct mismatch=0 |
| 4 | npm config（userconfig=/dev/null） | 0 | official registry，ignore-scripts=true，audit/fund=false |
| 5 | 恢复后 `npm ls --all --json` | 0 | problems=0 |
| 6 | 9 项 direct version/license 扫描 | 0 | MIT/Apache-2.0，Unknown=0 |
| 7 | `.env.example`/config/source/scripts 安全扫描 | 0 | secret/proxy bypass/egress/real provider/auto-publish 命中均 0 |
| 8 | `next.config.ts` 动态 root 断言 | 0 | 可移植 app root PASS |
| 9 | tracked/ignore/realpath/symlink/Home 边界断言 | 0 | forbidden tracked=0，37 候选全在 repo |
| 10 | Node24 direct lint | 0 | PASS |
| 11 | Node24 direct typecheck | 0 | PASS |
| 12 | 恢复后 build 1 | 0 | PASS |
| 13 | 恢复后 build 2 | 0 | PASS |
| 14 | 两次 build 候选/status/lock/install-tree/config 指纹与 warning 断言 | 0 | 前后完全相等，warning=0 |
| 15 | Node24 `node:sqlite` `:memory:` 引擎身份查询 | 0 | SQLite 3.53.1/source id 匹配，external_calls=0 |
| X1 | 并发干扰期的第 2 次 build | 1（作废） | 共享 `node_modules` 被延迟清理命令移除；恢复后全量重跑 |
| X2 | 变量名覆盖 zsh PATH 的组合命令 | 127（作废） | 无文件变更；更正变量名并完整重跑 exit 0 |

## 11. 已验证、未验证与错题自检

### 11.1 已验证

- Node24 归档字节 SHA、Darwin arm64 二进制、Node/npm 版本和 `.local` 隔离路径精确匹配。
- lock SHA 稳定，399/399 resolved 与 integrity 完整，当前安装树 `npm ls` problems=0。
- ignore-scripts 项目配置与恢复命令收据一致；本复验没有运行安装命令或 lifecycle。
- 9 项 direct dependency 版本与许可证通过，Unknown=0。
- `.env.example`/config/source/scripts 无真实 secret、代理/TLS 绕过、真实 provider/外联或自动发布开关，三个 `REAL_*` 均逐字为 `false`。
- Next root 位于 app，无用户绝对路径字面量；tsconfig/next-env 不再被 build 自动改写。
- 恢复后 lint/typecheck/双 build 全部 exit 0；37 个 Git-visible 候选、status、lock、install-tree 和配置指纹前后相等；root/multiple-lock/config rewrite warning=0。
- `.local/node_modules/.next/tsbuildinfo` tracked count=0，Home lock 没有进入仓内候选或本轮变更。
- Node24 内存 SQLite 身份为 3.53.1，source id 与开发报告一致。

### 11.2 未验证/结论不扩展

- `SHASUMS256.txt` 本轮未独立网络回源或 PGP 验签；字节/SHA-256 门槛已通过。
- lifecycle 结论基于统筹部精确 ignore-scripts 命令收据、项目配置与当前树；本轮没有 OS 系统调用追踪来回溯每个历史进程。
- 本轮没有重跑 D27E44 的完整 SQLite WAL/锁/SIGKILL 故障探针；只独立复核引擎身份。
- Repository/migration、fixture seed、CAS/lease/outbox、业务 schema/hash round-trip、四页 UI/API、admin session/Origin/CSRF、真实 loopback 端口、响应式/无障碍/AT 尚未实现或复验。
- R12 完整运行时 deny-all harness、真实 provider/Base/平台/AI/媒体/发布、生产存储、网络文件系统、多实例、容量、RTO/RPO 与部署继续未验证且未授权。
- direct license 通过没有覆盖所有 transitive dependency 的发布法务/SBOM 收口。

### 11.3 错题自检

- 没有为了消除 Next 警告而读写或删除 Home lock；root 只由 app 配置固定。
- 没有在 `next.config.ts` 写入用户名或定制绝对路径。
- 没有只查 index 中的 `app/README.md` 就声称零漂移；已覆盖 37 个 cached + untracked non-ignored 候选。
- 没有将 ignored `.local`、`node_modules`、`.next` 或 `tsbuildinfo` 写成 tracked 产物。
- 没有隐藏开发部首轮 P1/P2、共享安装树延迟清理造成的 exit 1，以及本轮组合命令的 exit 127；无效收据均作废并重跑。
- 没有执行安装/清理共享依赖树，没有修改 Spec、accepted ADR、data、design 或 app。
- 没有把 preflight PASS 扩展为 C 层业务实现、完整安全验收、生产 SQLite 结论或真实外部能力授权。

## 12. 收口

当前 Node24/npm/lock/license/config/build 与静态 no-secret/no-egress 前置安全门槛已满足，唯一最终判定为 **PASS（P0=0，P1=0）**。经本轮暴露的共享安装树并发清理历史已记录，恢复后的稳定重跑收据才用于最终结论。后续业务实现、完整 R12 deny-all、真实外部能力和部署仍需独立任务与对应门禁。

TASK_STATE_OK
