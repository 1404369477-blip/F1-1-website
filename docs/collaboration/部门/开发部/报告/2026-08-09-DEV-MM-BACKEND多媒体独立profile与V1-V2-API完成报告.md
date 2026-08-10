# DEV-MM-BACKEND 多媒体独立 profile 与 V1/V2 API 完成报告

- 任务：`TASK-20260809-BA9999`
- 部门：开发部
- 日期：2026-08-09
- 范围：`DEV-MM-01..03`
- 结论：开发实现与任务内本地验收 `PASS`
- 风险结论：`P0=0 / P1=0`
- 外部调用：`0`

## 1. Impact 与边界

本任务新增：

- `app/migrations/profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql`
- `app/src/server/db/public-multimedia-synthetic.ts`
- `app/scripts/public-multimedia-profile.ts`
- `app/src/tests/public-multimedia-backend.test.ts`
- `app/.local/f1plus1-public-multimedia-synthetic.sqlite`
- 本报告

本任务只为第三个 closed profile 修改以下既有接线：

- `app/src/server/config/env.ts`
- `app/src/server/db/profile.ts`
- `app/src/server/db/seed.ts`
- `app/scripts/db-migrate.ts`
- `app/scripts/seed-fixtures.ts`
- `app/scripts/serve.ts`
- `app/src/server/health.ts`
- `app/src/server/public/runtime.ts`
- `app/src/server/public/types.ts`
- `app/src/server/public/error.ts`
- `app/src/server/public/http.ts`
- `app/src/server/public/repository.ts`
- `app/src/app/api/public/stories/[publicId]/route.ts`

没有修改 package/lock、旧 migration、accepted ADR、data、Spec、公开 UI、Admin 或设计文件；没有新增依赖、Git stage/commit/reset/clean、真实媒体、真实 provider/Base、外部网络写入、发布或部署。

## 2. 后端闭环

### 2.1 独立 profile 与原子安装

- profile：`public-multimedia-synthetic`
- canonical DB：`app/.local/f1plus1-public-multimedia-synthetic.sqlite`
- contract：`public-read-v0.2`
- fixture set：`public-multimedia-0-1-4-v0.5`
- exact selector：旧 `0001` + 旧 `0002` + scoped `0003`
- `user_version=3`
- 新 DB 为 `0600`、当前用户持有、regular、`nlink=1`；最终没有 WAL/SHM/candidate 残留。

首次创建使用私有随机 candidate、单一 `BEGIN IMMEDIATE` seed、checkpoint/close、只读完整复算和 hard-link no-replace 安装。安装中断恢复对 candidate/canonical 两端执行 regular、非 symlink、owner、私有权限、同 dev/ino 与精确 `nlink=2` 门禁；完整只读复算和二次身份检查通过后才收敛硬链接。任何验证失败均 fail closed。

实现保留一个任务内可恢复历史文件：`app/.local/f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite`。它是 scoped migration 增加 UPDATE 第五图约束前的第三 profile 候选，未被运行时引用；未在本任务擅自删除。

### 2.2 seed、ledger 与完整性

最终运行收据：

| 项目 | 值 |
| --- | --- |
| graph canonical root | `6d4602ac73099dfb82610d46e835fc09f839e7a4c7a4a395f0c1a343fb8010f3` |
| migration selector root | `336a8721d75a24ac956b4d7cdecba4515fc136f96d89f91f3304293b0f6c600c` |
| schema fingerprint | `b39672c45af95027f9ae32a5610b1d2c71c49c38d79897e1d42a8a71771efe8f` |
| profile ledger root | `f762c35cc8231586b8b3d4b9d060df1407aa7424d8d7091b8e80e6304f9d54e1` |
| scoped migration SHA-256 | `1f88116c62d2d29e469ff0dce356d07b41c8b142a00769774a3cf67709968b43` |
| canonical DB SHA-256 | `a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c` |

行数为 `source=1`、`captured_items=3`、`contents=3`、`events=0`、`summaries=3`、`media_candidates=5`、`release_bundles=3`、`review_decisions=3`、`publications=3`、`outbox_jobs=0`、`published_projections=3`。三条 PublishedProjection 分别为 0/1/4 图，总媒体 5；INSERT 与 UPDATE 两条数据库 trigger 均拒绝同 Content 第五图。

`db:migrate`、连续两次 `seed:fixtures` 与 `runtime:assert-ready` 均 exit 0。两次 seed 均 `inserted=false`，全部 roots 与行数保持不变。目标测试覆盖 28 个写点故障注入，均要求整事务零部分提交。

### 2.3 Repository 与 V1/V2 API

Repository 从唯一 PublishedProjection 反查 Publication、ReviewDecision、ReleaseBundle、Summary、Content 与 MediaCandidate；逐层核验身份、状态、版本 hash、approved bundle、rights/safety、媒体引用、数量、顺序与存储 presentation。响应只由已验证的数据库闭链构造。

- Accept 缺失、`*/*`、`application/json`：V1。
- 仅精确 `application/vnd.f1plus1.public-read-v0.2+json`：V2。
- 多值、参数化或其他值：`406 PUBLIC_MEDIA_VERSION_UNSUPPORTED`。
- 坏 hash、rights、safety、顺序、重复或第五图：整请求 `500`，无 partial gallery/fallback。
- feed、detail、related 复用同一版本选择器；成功和 Problem 响应均 `Cache-Control: no-store`。

真实 production bundle 仅绑定 `127.0.0.1:3000` 的任务实例完成 HTTP 聚焦验收：health `200/ready/public-read-v0.2`；V1 feed `200`、3 条；V2 feed `200`、媒体计数 `[4,1,0]`；`public-mm-gallery` V2 detail `200`、4 图、2 条 related；参数化 JSON Accept 返回 `406`。全部响应为 `no-store`。验收后任务实例已停止，端口无监听，已按 owner/mode/nlink/size 校验并仅清理本实例留下的精确空 WAL `0` 字节与 SHM `32768` 字节。

一条 HTTP 操作者探针作废历史予以保留：首次把冻结 vendor 类型误写为 `public-read-v2`，服务按合同返回 `406`；该探针没有修改代码或数据库。最终收据使用精确 `public-read-v0.2` media type。

## 3. 旧 profile 零漂移

| 受保护 artifact | 最终 SHA-256 | 结果 |
| --- | --- | --- |
| `0001_local_foundation.sql` | `9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176` | 与独立前置一致 |
| `0002_source_fixture.sql` | `12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031` | 与独立前置一致 |
| `0003_public_synthetic_profile.sql` | `57df4d990cded9d69551d0acf97615ef5d9fd3d5ecceb05ebb10d3812549498a` | 与独立前置一致 |
| M3 DB | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` | 与独立前置一致 |
| public-synthetic DB | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` | 与独立前置一致 |

第三 profile 每次 runtime 打开前都会重新验证三份 accepted closed receipt 的 canonical bytes、自哈希、精确字段、时效、validator identity、旧 DB SHA 与 sidecar absence；旧 V1 profile 的目标测试仍为 V1 `200`、V2 `406`。

## 4. 验证收据

全部命令使用项目内 Node `24.18.0`、npm CLI `11.16.0`；没有安装依赖。

| 验证 | 最终结果 |
| --- | --- |
| 目标 Vitest `src/tests/public-multimedia-backend.test.ts` | exit 0；1 file、5 tests PASS，448 ms |
| TypeScript `tsc --noEmit` | exit 0 |
| Next production build | exit 0；公开 API/页面路由构建成功 |
| migrate + seed ×2 + runtime ready | 全部 exit 0；三次 roots/counts 一致 |
| production HTTP 聚焦矩阵 | health/V1/V2/detail/related/406 全部符合合同 |
| no-egress | 目标测试进程 guard + 最终本地 loopback 收据；`externalCalls=0` |
| real media/Base | `realMedia=0`、`writesToBase=false` |
| 对抗审查 | 最新候选 `P0=0 / P1=0` |

构建存在一条 Turbopack NFT 静态跟踪 warning：动态、受门禁的本地文件路径可能让 tracing 范围偏宽；编译、类型检查和路由生成均成功。当前不部署，warning 没有转化为外部 I/O 或运行时完整性绕过，记为后继部署打包任务的 P2/未验证项。

## 5. 核心源码身份

| 文件 | SHA-256 |
| --- | --- |
| `app/src/server/db/public-multimedia-synthetic.ts` | `844d8edc2520d5e0dcf446e9f0d4b11ea843624c8f1b8e423c0c1236c664bfe0` |
| `app/src/server/public/repository.ts` | `4c114687da195eb1a077889e924c43760901e30f2fc61e397b46f6341843ec1c` |
| `app/src/server/public/http.ts` | `348b6f0abeebaacd3108eeba1f793b006a4e53c1373e84fb401977471c80c8a0` |
| `app/src/server/public/types.ts` | `64d61d5f4e255592febc333ec690bb94cb95bf0f8bc2beede150268462e8aa95` |
| `app/src/server/health.ts` | `bf52544d19876637b64476a0cb036e0313c9b00c516262d53afa6690acaf50ed` |
| `app/scripts/public-multimedia-profile.ts` | `257cd0e6e8c33b121b4e2e12ff3476cfaf0b478d1d776954955e9527f545db58` |
| `app/src/tests/public-multimedia-backend.test.ts` | `67d00829e0ccae0f47cf5de2d7bc3b3e93dbe702930c26a95dc8197f4075601b` |

## 6. P0/P1 与未验证项

- 开发自审与最终对抗审查：`P0=0 / P1=0`。中间审查提出的旧 receipt runtime gate、字段/secure read、Repository 二真值、UPDATE 第五图、migration pins、no-replace、关闭后只读复算、hard-link crash recovery 与 symlink/private identity 问题均已在最终候选关闭。
- 未验证：正式前端 `DEV-MM-04`、真实视觉与交互、独立测试部/安全部复验、部署包 tracing 内容；这些均不计入本任务 `DEV-MM-01..03` 完成范围。
- 继续关闭：真实媒体、外部来源/provider、Base、Admin、RSS、发布、部署与任何外部 I/O。
- 工作区原有 dirty/untracked 状态保持；没有 Git 操作或无关清理。

## 7. 四件套

- artifacts：独立 profile migration/DB/seed/ledger/health、Repository、V1/V2 API、受控 CLI、目标测试与本报告。
- verified：exact selector、0/1/4 图闭图、5 个媒体、原子 seed/28 写点回滚、重复零漂移、V1/V2/406/500、旧 profile 零漂移、Node24 目标测试/typecheck/build/HTTP、P0=0/P1=0、externalCalls=0。
- unverified：正式前端与独立测试/安全复验；部署 tracing warning；真实外部能力继续关闭。
- mistake-check：已核对 profile/路径隔离、三条 selector、ledger/schema/root、旧 closed receipt、single handle、ATTACH、seed 原子性、第五图、Repository DB 闭链、Accept、no-store、错误泄露、sidecar、进程清理、依赖/Git/外部能力边界。
