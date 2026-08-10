# F1+1 本地应用

这是 F1+1 M4 单包 Next.js App Router 工程入口。技术路线已由
`ADR-M4-KICKOFF-001` 接受，VS-0 已接通本地、fixture-only 的安全地基；真实
provider、Base、采集、AI/媒体、发布和部署能力仍然关闭。

## 版本栅栏

- Node.js：`24.18.0`
- npm：`11.16.0`
- Next.js：`16.2.11`
- React：`19.2.0`

`.nvmrc`、`.node-version`、`package.json.engines`、`packageManager` 和
`.npmrc` 共同表达运行时栅栏。项目隔离工具链位于
`.local/toolchains/node-v24.18.0-darwin-arm64/`（被 gitignore）；系统 Node 25
不能作为 VS-0 验收证据。

## 目录合同

- `src/app/`：App Router 页面与后续本地 Route Handler
- `src/modules/`：领域模块边界，当前只保留目录占位
- `src/server/`：server-only 配置、数据库、provider、worker 与安全边界占位
- `src/styles/`：全局样式与设计 token 占位
- `src/tests/`：正式 Vitest 单元/合同/失败路径测试目录
- `migrations/`、`fixtures/`、`scripts/`：本地数据与工具边界

## 当前可见命令

`verify:env` 使用 canonical allowlist 和 fixture/mock/manual-only profile；
`db:migrate` 只追加本地 migration/ledger，并对 v1/v2 的 table、column、CHECK、index
及 partial-index WHERE 做静态 schema receipt 复验；`seed:fixtures` 使用已接受的
33→39 实现桥接，写入 59 条本地 Source，59/59 保持 `enabled=false`，不写 Base、
不调用外部能力。原始 M3 provider 仍保留 59×33 原始合同；39 字段只属于已接受的
local implementation projection。

`runtime:assert-ready` 不执行 migration 或 seed 写入；它会打开 SQLite 进行完整性检查，
因此可能完成 SQLite 自身的 WAL 恢复和 sidecar 维护。检查范围包括配置、capability、
DB migration/ledger/schema、bridge hash、seed ledger 和 59 行 projection。`dev` 与
`start` 在同一 npm script 内先执行该检查（项目 `ignore-scripts=true`，不依赖 npm
pre-hook），任何附加 argv 都会在导入 Next 或创建监听前以稳定 JSON 拒绝；正常命令
固定绑定 `127.0.0.1:3000`。`/` 与 `/api/health` 每次按实际 DB 状态返回 `ready` 或
`not_ready`，不会用静态常量伪报 seed 成功。CLI 失败只输出 allowlist 中的
`event/status/reasonCode/externalCalls`，不序列化原始 message、stack、路径或 secret。
`check` 顺序执行 verify、migrate、seed、runtime readiness、test、VS1 contract
test、lint、typecheck、build，并在 build 后用真实子进程完成正常 `start`/health
验收。`worker:mock -- --once` 与 `test:contract` 已接通 accepted VS1 本地
synthetic fixture：每次创建独立 `0700` 临时根和唯一 `0600` SQLite，以固定 registry
执行单 operation、最多三次的采集、清洗、去重和 mock 摘要纵切，输出 closed receipt
及三行 V-OP JSONL；真实 provider、RSS、外部 AI 与非 loopback I/O 继续关闭。

完整 R12 的 OS/系统调用级 deny-all（DNS、HTTP、raw socket、subprocess/child_process）
仍在后续独立门禁中；当前 `externalCalls=0` 只表达本次 fixture-only 代码路径和运行
收据，不代表已完成进程级网络沙箱验收。health 同时返回
`filesystemIsolation=local_trusted_user`、`toctouProof=false` 和
`networkEnforcement=pending`，明确本轮采用本机可信单用户边界；恶意同 UID 进程在
两次 pathname open 之间竞争替换仍是待用户门禁接受的残余风险。

`migration_ledger` 每次访问都会核对记录数量、顺序、全部收据字段、migration SHA 和
实际 schema receipt；漂移会 fail closed。当前 v1/v2 没有 UPDATE/DELETE 触发器，
因此这里的 append-only 是应用写路径与下次访问校验保证，不是 SQLite 层物理不可变。

`package-lock.json` 已由统筹线程使用官方 npm registry、npm `11.16.0`、
IPv4-first 和 `--package-lock-only` 生成。本任务完成了独立静态审计：

- lockfileVersion 为 3，根 engines 与 `package.json` 一致；
- 463 个非根 package 条目全部使用 `https://registry.npmjs.org/` resolved；
- 463 个条目全部具备 sha512 integrity；
- 直接依赖与 devDependencies 的精确版本和 `package.json` 一致；
- 精确新增的 `zod@4.4.3` 与 `vitest@4.1.10` 均为 MIT；
- 没有 latest/canary/preview、git、file、非官方 HTTP 源或浮动 resolved。

lockfile 中存在 `hasInstallScript` 元数据：`fsevents@2.3.3`、`sharp@0.34.5` 和
`unrs-resolver@1.12.2`；另有 optional/native 平台包条目。它们属于解析元数据，
统筹生成依赖时使用 `--ignore-scripts`，没有把 lifecycle 元数据当作已执行脚本。

## 环境示例

复制 `.env.example` 到本地环境文件时，只能保留其中的安全默认值。该文件没有任何
凭证，也不会开启真实外部 I/O。

关联：[`../docs/spec.md`](../docs/spec.md) · [`../docs/decisions/`](../docs/decisions/)
