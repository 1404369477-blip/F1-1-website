# M4 B 层 lockfile 恢复与门禁闭合报告

## 唯一判定

**B 层 overall：PASS（P0=0，P1=0）。**

本任务只判断 B 层静态初始化和可信 lockfile 合同。Node24 运行、npm ci、SQLite、
构建、测试、安全运行收据和业务纵向切片继续属于 C 层 pending；本报告没有把
Node25 运行事实写成 C 层通过。

此前 TASK-20260802-F8BF72 因官方 registry/DNS 不可达而记录的 PARTIAL 历史保留，
本报告只关闭后来恢复的 lockfile 阻断，不改写该历史任务 JSON。

## 任务与授权

- 任务：TASK-20260802-D2724D《审计官方lockfile并关闭M4 B层初始化门禁》
- 阶段：M4-B-lockfile-recovery
- 来源：A 轴 accepted ADR-M4-KICKOFF-001 与 Spec
- 范围：只读审计现有 app/package-lock.json，修订 app/README.md，形成 B 层报告
- 禁止项：npm ci、任意 lifecycle、node_modules、系统安装、业务代码、真实外联、
  provider/Base/Collector/平台/AI/媒体/发布/部署

## lockfile 生成上下文

统筹线程已提供生成收据：官方 registry、IPv4-first、精确 npm 11.16.0、
package-lock-only、ignore-scripts/no-audit/no-fund/fetch-retries=0；命令 exit 0。
当前 Node25 只产生预期的 EBADENGINE 警告，因为 package.json 的 Node 栅栏精确为
24.18.0；没有生成 node_modules，也没有运行第三方脚本。

本任务没有重新运行 npm ci、安装命令或 lifecycle。只读取和解析已有
app/package-lock.json，并用 Python 标准库执行静态断言。

## 独立静态审计结果

### 根合同与精确版本

| 项目 | 结果 |
| --- | --- |
| lockfileVersion | 3，PASS |
| lock 根 name/version | 与 package.json 的 f1-plus-1-app / 0.0.0 一致 |
| lock 根 engines | node 24.18.0、npm 11.16.0，一致 |
| package.json packageManager | npm@11.16.0，PASS |
| 直接 dependencies | next 16.2.11、react 19.2.0、react-dom 19.2.0，一致 |
| 直接 devDependencies | 6 项精确版本与 package.json 一致 |
| 根 requires | true，PASS |
| node_modules | 不存在，PASS |

### resolved 与 integrity

- 非根 package 条目：399。
- resolved 条目：399/399，全部以
  https://registry.npmjs.org/ 开头。
- integrity 条目：399/399，全部为 sha512 格式。
- 未发现非官方 resolved、git、github、git+、file、workspace、非官方 HTTP 源。
- 未发现 resolved/version/dependency spec 中的 latest、canary 或 preview 漂移。
- 直接依赖的 node_modules 条目版本逐项等于 package.json 的精确版本。

### script 与 optional/native 元数据

静态 lock 元数据中有两个 hasInstallScript 条目：

| package | version | 静态含义 |
| --- | --- | --- |
| sharp | 0.34.5 | package metadata 标记存在 install script |
| unrs-resolver | 1.12.2 | package metadata 标记存在 install script |

另有 64 个 optional 条目，主要包括：

- Next SWC 的各平台包：@next/swc-darwin-*、@next/swc-linux-*、
  @next/swc-win32-*；
- sharp/libvips 的各平台包：@img/sharp-*、@img/sharp-libvips-*；
- unrs-resolver 的平台 binding；
- @emnapi、@napi-rs 相关运行时包。

这些字段只表示 npm lockfile 的 package metadata。本任务没有执行 npm ci、安装、
postinstall/install/prepare 等 lifecycle；生成上下文明确使用 ignore-scripts，
并且工作区没有 node_modules。此项不构成 C 层脚本安全或运行时安全验收，后续
C 层仍需在隔离环境中复核。

### package 与 README 一致性

- app/package.json 的 Node/npm/Next 栅栏保持精确。
- app/.nvmrc 与 app/.node-version 保持 24.18.0。
- app/.npmrc 保持 engine-strict=true、ignore-scripts=true、no audit/fund 默认。
- app/.env.example 仍为 loopback、fixture、mock、manual_only、REAL_* = false。
- canonical 目录和最小 App Router scaffold 未被改动。
- app/README.md 已删除“无 lockfile/DNS 阻断”的旧现行叙述，改为记录：
  lockfile 已生成并通过本任务静态审计，C 层仍 pending。

## B 层验收矩阵

| P 项 | 证据 | 结果 |
| --- | --- | --- |
| P0-版本栅栏 | package.json、.nvmrc、.node-version、.npmrc、lock 根 engines | 0 |
| P0-package/lock 一致性 | 根依赖、devDependencies、直接 node_modules 版本逐项一致 | 0 |
| P0-来源与完整性 | 399/399 官方 registry resolved、399/399 sha512 integrity | 0 |
| P0-浮动源 | latest/canary/preview/git/file/非官方源扫描 | 0 |
| P1-script边界 | hasInstallScript 仅作为元数据列出，生成使用 ignore-scripts，无 node_modules | 0 |
| P1-README/目录/env | README、canonical 目录、安全默认值和 scaffold 检查 | 0 |

因此 B 层唯一判定为 PASS。C 层 pending 不降级 B 层静态判定，也不由本报告提前
打开。

## C 层仍 pending

- Node 24.18.0 实机运行与 npm 11.16.0 的 npm ci 收据；
- verify:env、SQLite node:sqlite、WAL、事务、timeout、migration、recovery；
- mock adapter/worker、in-process API 合同和失败路径；
- lint、typecheck、build、test、security/deny-all；
- 真实 127.0.0.1 端口独立验证；
- 业务纵向切片、UI/无障碍/响应式和任何真实 provider/Base/平台能力。

## 官方来源指针

- Node.js v24.18.0 LTS：https://nodejs.org/en/blog/release/v24.18.0
- Node.js v24 归档（包含 npm 11.16.0 版本表）：https://nodejs.org/en/download/archive/v24.0.0
- npm next 16.2.11：https://www.npmjs.com/package/next/v/16.2.11
- npm eslint-config-next 版本页：https://www.npmjs.com/package/eslint-config-next?activeTab=versions

