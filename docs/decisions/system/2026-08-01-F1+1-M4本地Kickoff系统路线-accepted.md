---
type: system_adr
status: accepted
date: 2026-08-02
department: 产品部
decision_id: ADR-M4-KICKOFF-001
related_task: TASK-20260802-8B5DCF
prior_candidate_task: TASK-20260801-847A78
decision_scope: 本地 Spec v1 候选的技术栈、工程边界、mock 闭环与首批纵向切片
---

# ADR-M4-KICKOFF-001：F1+1 本地 Kickoff 系统路线（accepted）

> 本 ADR 接受 M4 A 轴静态合同，并仅开放 B 层本地 `app/` 初始化。它不改变 accepted 的 ADR-SOURCE-001，不把本地 fixture 当成 Base 业务真值，不开放 C 层运行验收，也不授权真实平台采集、真实表单提交、自动发布、部署、付费或外发。

## 1. 背景与证据边界

### 1.1 任务授权

用户已授权在以下范围内自主技术选型和本地 app 开工：不付费、不部署、不外发、不切 Base 业务真值、不启动真实采集、不进行真实表单提交、不自动发布。本次 accepted 只开放 B 层本地初始化；C 层实现验收、部署和全部真实外部能力继续关闭。产品部只维护 Spec、系统 ADR 和产品规划，不写正式业务代码。

### 1.2 已吸收输入

- [`docs/spec.md`](../../spec.md)：白名单信源、15 分钟目标、中文整理、图片候选、人工审核、公开信息流与原链闭环。
- [`2026-07-30-F1+1-MVP与系统架构决策包-proposed.md`](2026-07-30-F1+1-MVP与系统架构决策包-proposed.md)：模块化核心、隔离适配器、durable inbox/outbox、CAS、Bundle Hash、故障恢复与自动发布关闭。
- [`ADR-SOURCE-001`](2026-08-01-F1+1-信源库A到D演进路线-accepted.md)：A→D 顺序、Base 单一业务真值、D 单向 `Base → 本地 last-known-good`、三道独立切换门禁。
- [`F1+1 全站设计规范 v0.1`](../../../design/ui/F1+1-全站设计规范-v0.1.md)：深色默认、双主题、控件圆润/内容硬朗、公开流/详情/审核/信源管理四类页面、状态可见、WCAG 导向和响应式约束。
- [`F1+1 首批页面实现级设计合同 v0.1`](../../../design/ui/F1+1-首批页面实现级设计合同-v0.1.md) 与 [`Token/map JSON`](../../../design/ui/F1+1-首批页面token-map-v0.1.json)：四页共享壳层、实现级状态、320/390/768/1024/1200/1440/1600px 响应式验收、键盘/屏幕阅读器/强制色/减少动效规则；路由提示和第 11 节未决项保持开放。
- [`M3 影子建表执行包`](../../collaboration/部门/产品部/报告/2026-08-01-F1+1飞书Base影子建表-M3执行包.md)：1 个 Base、2 张表、3 个 grid、两题表单、59 条保守数据的字段与状态合同。
- [`M3 离线载荷报告`](../../collaboration/部门/数据部/报告/2026-08-01-M3飞书Base影子导入离线载荷报告.md)：33/9 字段、59×33 映射、固定批次和 `enabled=false` 默认值。
- [`M3 建库与导入执行收据`](../../collaboration/部门/统筹部/报告/2026-08-01-M3飞书Base影子建库与59条导入-执行收据.md)：CLI 资源/表/记录回读的已验证收据；它不证明 `base_direct`/`base_snapshot` provider 或 Collector 已接通。
- [`本地 MVP 数据合同与安全样例`](../../collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md)、[`2026-08-02 数据合同 v0.2 升级报告`](../../collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md) 及 [`data/mvp-contract-v0`](../../../data/mvp-contract-v0/)：此前 `mvp-local-v0.2` 数据任务已交付并 ACK；本轮 v0.3 首轮安全/测试复验均为 `P0=0、P1=1、FAIL`，唯一 P1 是 D80846 ACK 时态漂移。`mvp-local-v0.3` 修订已由 `TASK-20260802-D80846` 完成并由统筹部 ACK；随后安全部 `TASK-20260802-337780` 与测试部 `TASK-20260802-ABB9F8` 聚焦复验均为 `PASS / P0=0 / P1=0`。数据产物保持冻结输入，领域实体保持本地 domain-only，不反写 M3。
- [`安全基线审核报告`](../../collaboration/部门/安全部/报告/2026-07-30-F1+1采集内容处理与发布安全基线-审核报告.md)：真实平台持续采集、公开上线和自动发布仍不准入；离线/合成/mock 实验可继续。
- 最新 M3 安全报告：固定 CLI 白名单、先读后写、超时不可盲重放、表单不分享、ACL 协作者 Unknown、OAuth 142 scopes 残余风险。
- [`M4 工程开工预检报告`](../../collaboration/部门/开发部/报告/2026-08-01-M4工程开工预检报告.md)：该历史预检仅证明可抛弃 Python/SQLite 逻辑探针重复通过且 `external_calls=0`，未证明真实端口、安装网络或生产存储；后续 B 层静态 scaffold 与 package-lock 已由 D2724D 复核通过。Node 25/Python 3.14/SQLite 仍仅为环境事实，不能替代正式运行时合同。
- [`飞书 OAuth 最小 Scope 与撤权轮换官方语义核验`](../../collaboration/部门/研究部/报告/2026-08-01-飞书OAuth最小Scope与撤权轮换官方语义核验.md)：按操作拆分 granular scope、app 开通/user grant/token scope/resource ACL 三层门禁；本轮只吸收权限 profile，不执行重授权、撤权或轮换。
- [`M4 工程路线与运行时可行性审核报告`](../../collaboration/部门/开发部/报告/2026-08-01-M4工程路线运行时可行性审核报告.md)：A/B/C 三轴、Node 24.18.0/Next 16.2.11/npm 11.16.0 精确候选、0/1 mock worker、SQLite WAL/事务/recovery 静态合同；B/C 收据尚未前置。
- [`M4 本地安全门禁与外部 IO 隔离审核报告`](../../collaboration/部门/安全部/报告/2026-08-01-M4本地安全门禁与外部IO隔离-审核报告.md)：R1–R13 的 A 层精确默认值、拒绝条件和 B/C 实现收据分界；真实外部 IO、认证、资源写入继续关闭。
- [`Spec v1 / M4 ADR 跨合同可验收性只读复核`](../../collaboration/部门/测试部/报告/2026-08-01-Spec-v1与M4-ADR跨合同可验收性复核报告.md)：P0-01–P0-09、P1 缺口、统一基线和 A/B/C Go/No-Go 证据。
- [`TASK-20260802-90B1C2 数据合同修订任务`](../../collaboration/tasks/TASK-20260802-90B1C2.json) 与当前 [`TASK-20260802-D80846`](../../collaboration/tasks/TASK-20260802-D80846.json)：前序 v0.2 任务已交付并 ACK；当前 v0.3 修订已完成并由统筹部 ACK，首轮 v0.3 安全/测试复验的唯一时态 P1 已由两份聚焦复验 `PASS / P0=0 / P1=0` 收口。本 ADR 只引用 `data/mvp-contract-v0` 唯一冻结输入，不复制第二套领域 schema。

### 1.3 事实、建议、unknown 的分界

- **已接受（路线/业务约束）：** 白名单内容闭环、人工审核、A→D 路线及其单一真值/单向同步不变量。
- **已验证事实（本轮输入）：** M3 影子资源存在且保持影子态，CLI 资源/表/记录回读已有独立收据；设计部已核收首批四页实现级交接与 Token/map 文件，视觉方向差异为 0；数据部前序 v0.2 任务已交付并 ACK。
- **本 ADR 已接受（A 层静态合同）：** 本地技术栈、目录、命令、fixture provider、首批纵向切片和本地安全开关；它们只约束本地 B 层初始化与后续 C 层验收，不等同生产部署或外部能力授权。设计实现采用 F1+1 本地 Token/CSS 合同，Appica UI 与 Base UI 仅作为组件行为/语义参考，不选为包依赖或全局样式基座。
- **仍 unknown：** 首批生产信源与平台审批、真实平台采集可行性、AI 供应商数据条款、图片权利、部署地域与容量、生产存储选型、M3 直接协作者边界、OAuth 最小 grant 收敛、`base_direct`/`base_snapshot` provider 与 Collector 的真实 API 读取、真实本地 HTTP 端口、Repository/业务实现、生产角色和跨网络权限。M4 路由候选、local-dev loopback 权限边界、审核布局、无媒体降级和本地 Token/CSS 已进入候选合同；其实现/AT 属于 C 层，VS-0 仅获准开工，不新增 A/B 用户确认门禁。
- **本轮 A 轴状态：** 统一 v0.3 基线已写入本 ADR/Spec；安全/测试首轮 v0.3 复验（对应第二轮 A 轴复验）保留 `P0=0、P1=1、FAIL` 历史，随后两份聚焦复验均为 `PASS / P0=0 / P1=0`。本 ADR 现为 `accepted`，A 轴静态合同完成收口；D27E44、7BFD99、6F480F 的 C 层本地预检均为 `PASS / P0=0 / P1=0`，当前允许 VS-0 安全地基与 fixture provider 本地开工；Repository/UI/API/完整 R12/VS-1–3、真实 provider、Base、Collector、采集、发布和外部 I/O 继续 pending/closed。

## 2. 决定（accepted｜A 轴静态合同）

### 2.1 总体形态

采用“单一 Web/控制核心 + 同仓隔离 Worker + SQLite 状态库 + durable inbox/outbox + provider/adapter 接口”的本地形态。

- Web/控制核心负责公开读模型、审核页面、信源页面、状态查询和本地管理 API。
- Worker 以单独命令启动，消费本地 durable inbox/outbox；M4 只消费 fixture/mock 任务。
- 适配器、摘要、媒体和发布模块保留独立接口与权限边界；M4 不实现真实外部 I/O。
- SQLite 仅作为本地开发/测试状态库。它承载可回放的测试状态，不替代 A/D 阶段 Base 业务真值。
- 不引入 Redis、消息云、托管数据库、对象存储、第三方自动化平台或微服务编排。

### 2.2 技术栈

| 层 | 选择 | 选择理由 | 明确不做 |
|---|---|---|---|
| Web/UI/BFF | `next@16.2.11` + React + TypeScript、App Router | 与公开信息流、详情、后台审核共用一个本地进程；Route Handler 需要 SQLite 时显式 Node runtime，Client/Edge 不得导入原生 SQLite | 不拆前后端仓库，不使用 Pages Router，不使用 canary/latest |
| 运行时 | Node.js `24.18.0` 精确候选；npm `11.16.0` 候选；`.nvmrc`/`.node-version`、`package.json.engines`、`packageManager`、`.npmrc engine-strict=true` 同步 | 个人维护成本低，TypeScript、Web、Worker 共用语言；精确 patch 便于复现和安全回写 | 当前机器 Node 25.5.0、npm 11.8.0 不能作为通过证据；初始化时重新核对官方发布物/SHASUMS |
| 本地状态库 | Node `node:sqlite` + SQL migration + repository interface；WAL、`synchronous=FULL`、`busy_timeout`、`BEGIN IMMEDIATE`、有限 `lock_contention` 重试、`user_version` migration、crash recovery/checkpoint | C 层本地预检已在 SQLite 3.53.1 上通过；实际引擎 `sqlite_version()`/`sqlite_source_id()` 可审计 | 不把 SQLite 直接承诺为多实例生产数据库、网络文件系统或生产存储；Repository 正式实现、migration/CAS/lease/outbox 与生产行为仍待 VS-0/后续 C 验收 |
| 校验 | TypeScript 类型 + Zod 边界 schema | 外部 fixture、adapter、API、任务和发布 Bundle 在边界统一拒绝未知形状 | 不用类型断言掩盖不完整输入 |
| 样式 | 原生 CSS Modules/全局 token CSS | 直接复用设计规范 token，减少 UI 依赖与运行时 | 不引入大型组件库或 Tailwind 作为隐性设计系统 |
| 测试 | Vitest + Testing Library（页面切片）+ 合成 fixture | 覆盖状态机、幂等、失败路径和用户出口 | 不以真实平台账号作为测试前置 |
| 日志 | 结构化 JSON `console` sink + trace/correlation ID | 零日志服务依赖；本地可读且方便后续替换 | 不记录 token、原文全文、私人标识或内部密钥 |
| 进程形态 | 单 Web 进程 + 0/1 个同机 mock worker + 单一 SQLite 文件 | 控制并发与故障域，符合本地 M4 范围 | 不形成多实例生产合同，不依赖 Redis/Postgres/Docker |
| 包管理 | npm lockfile | 本地可用、单包合同简单、无额外 workspace 工具 | 不要求 pnpm、Docker 或云服务 |

Node `node:sqlite` 在 Node 24 文档中仍是 Release Candidate；因此数据库访问必须隔离在 `src/server/db/repository.ts` 后方。C 层预检已记录 `sqlite_version()=3.53.1`、`sqlite_source_id()` 及 WAL/FULL/事务/锁/recovery 收据，并拒绝低于 3.51.3 的实际引擎。Repository 正式实现、生产数据库和多实例行为仍需后续 C 门禁；不能由本地 spike 推导生产可用性。

### 2.3 设计依赖边界

- 首批实现以 [`F1+1 首批页面实现级设计合同 v0.1`](../../../design/ui/F1+1-首批页面实现级设计合同-v0.1.md) 和其 [`Token/map JSON`](../../../design/ui/F1+1-首批页面token-map-v0.1.json) 为 UI 合同输入：共享 `F1PageShell`、`public-feed`、`content-detail`、`review-queue`、`source-management` 四页，页面状态矩阵、双主题、响应式断点和无障碍约束纳入 VS-3 验收。
- Appica UI、Base UI 只提供公开组件的行为/交互语义参考。M4 不安装其包、不引入其 `styles.css`、不复制演示资产；视觉 Token、字体、圆角、密度、玻璃降级和页面构图均由 F1+1 本地合同控制。
- 设计文件中的 `route_hint` 不覆盖 3.2 已冻结的 M4 路由候选。生产角色、跨网络权限、字体构建/许可和无障碍 AT 的实现证据在 C 轴收集；Appica UI/Base UI 继续仅作行为/语义参考，不形成包依赖。

### 2.4 中国大陆与个人维护约束

1. M4 不部署；本地运行不依赖境外托管服务、付费 API、远程队列或远程数据库。
2. 未来部署目标必须单独确认运营主体、部署地域、数据区域、平台条款和 AI 跨境要求；本 ADR 不选择云厂商。
3. npm 依赖以 lockfile 固定；若安装网络受限，只允许用户自行配置合规镜像，仓库不写入凭证或固定第三方运行时服务。
4. 真实 X/Reddit/Instagram、图片代理、外部 AI 和飞书 provider 只有在各自授权/安全/法务门禁通过后才可实现；M4 使用 fixture/mock 并明确标记。
5. 开发部预检中的 Python/SQLite 逻辑探针只证明可抛弃的进程内合同路径；它没有证明真实端口、Web 框架、目标网络安装或生产数据库。正式运行时固定为 Node 24 Active/Maintenance LTS 目标；生产存储保留到部署阶段另立决策。

### 2.5 飞书只读权限门禁与 runtime profile（未启用）

- **M4-local-fixture-v0（当前唯一 runtime profile）：** `SOURCE_CONFIG_PROVIDER=fixture`、`ADAPTER_MODE=mock`、`SUMMARY_MODE=fixture`、`MEDIA_MODE=fixture`、`PUBLISH_MODE=manual_only`、`REAL_FEISHU_IO=false`、`REAL_EXTERNAL_IO=false`、`REAL_FORM_SUBMIT=false`，不创建 `FEISHU_*` 凭证变量；本地切片不申请、不交换、不刷新、不撤权任何飞书 token，也不访问真实 Base。
- **A/D-read-minimal-v0（未来候选 profile，不在本轮启用）：** 只在对应用户授权与 A/D 切换门禁通过后，按操作拆分申请/核对 granular scope：Base 元数据 `base:app:read`；表/字段/视图 schema 分别为 `base:table:read`、`base:field:read`、`base:view:read`；已知记录读取为 `base:record:read`，只有确有条件搜索需求才申请 `base:record:retrieve`；表单元数据需要时才申请 `base:form:read`。协作者或公共权限审计另需 `base:collaborator:read` / `docs:permission.setting:read`，不能从记录读取 scope 推导。`offline_access` 只有明确需要后台续期时才进入新授权决定；`auth:user_access_token:read` 属撤权事件能力，不是 Base 读 scope。聚合 `bitable:app:readonly` 与历史 `bitable:bitable:readonly` 不作为默认最小 profile。
- 每次真实读取必须同时满足 app scope 已开通、用户 grant/token 返回 scope 包含本次操作、目标 Base/表/记录 ACL 可读三层条件；403、scope 不匹配或 ACL unknown 时 fail closed，不自动扩大 scope。M3 当前 CLI 身份/token 已有独立只读验证，142 个用户 scopes 仍作为残余风险记录；本节不把它改写为“全部未验证”。
- 研究报告中关于 refresh 单次轮换、旧 access token 到期前继续有效、CLI 撤权错误可能被忽略的语义只作为后续安全门禁输入；本 ADR 不触发重授权、撤权、logout 或轮换。任何 profile 变化需新任务与用户确认。

## 3. 应用边界与目录合同

根目录 `app/` 已具备 B 层静态 scaffold、唯一 `package.json`/`package-lock.json`、版本文件、安全默认值和 canonical 目录；C 层预检已验证 Node24/npm ci/SQLite/lint/typecheck/build，`app/node_modules/` 当前存在且被 gitignored。当前仅允许 VS-0 安全地基与 fixture provider 本地实现，不创建 Repository/UI/API 业务代码。

```text
app/
├── src/
│   ├── app/                         # Next.js App Router 页面与 Route Handlers
│   │   ├── (public)/                # 信息流、详情、只读来源证据
│   │   ├── (admin)/                 # 本地开发审核/信源管理，非生产认证
│   │   └── api/                     # 仅本地合同中的公开读与本地管理 API
│   ├── modules/
│   │   ├── source-registry/         # SourceConfig、状态与 provider 接口
│   │   ├── ingestion/               # Observation、游标、inbox/outbox
│   │   ├── normalization/           # URL/时间/文本规范化
│   │   ├── dedupe/                  # 确定性 fingerprint 与关联
│   │   ├── summary/                 # 无工具 mock summary；真实模型待门禁
│   │   ├── media/                   # fixture/无图；真实下载待门禁
│   │   ├── review/                  # Bundle、审核 hash、人工状态机
│   │   ├── publication/             # 本地公开投影；默认 manual_only
│   │   └── shared/                  # epoch、错误分类、时间、ID、schema
│   ├── server/
│   │   ├── config/                  # 环境变量解析与 fail-closed 开关
│   │   ├── db/                      # node:sqlite、migration、repository
│   │   ├── providers/               # fixture、base_direct/base_snapshot 接口桩
│   │   ├── workers/                 # 本地 mock worker 入口
│   │   └── security/                # URL/HTML/媒体/日志安全边界
│   ├── styles/                      # 设计 token、主题、全局状态样式
│   └── tests/                       # 单元、合同、切片和失败路径测试
├── migrations/                      # 只追加 SQL migration
├── fixtures/                        # 合成/脱敏输入；不可放 token 或真实表单提交
├── scripts/                         # verify-env、seed-fixtures、reset-local 等
├── .env.example                     # 仅变量名与安全默认值
├── package.json
└── package-lock.json
```

以上 `app/src/tests/` 是本 ADR 的 canonical 测试目录；开发部预检报告中的 `app/tests/` 只是 disposable probe 的候选槽位，不并行采用。正式初始化前由开发部在 `docs/conventions.md` 与代码 ADR 中复核并落账。

目录不允许跨模块直接访问数据库连接；所有模块通过 repository 或明确的 domain command 交互。`src/app` 只能调用 server-side service/API，不得从客户端组件读取秘密环境变量。

### 3.1 页面与交互合同

M4 的页面切片按设计交接稿落在本地 mock 数据上，不代表生产路由或权限已接受：

- `public-feed`、`content-detail` 面向公开访客；`review-queue`、`source-management` 属于本地开发 admin 入口，四页共享 `F1PageShell`。
- 每页按 Token/map JSON 的 `pages.*.states` 全量逐项覆盖：Feed 含 `loading/empty/error/partial/offline-restricted/no-more/live-refresh`；Detail 含 `loading/not-found/error/withdrawn/media-missing/source-restricted/correction`；Review 含 `loading-list/empty/loading-detail/pending-review/saving/saved-needs-review/approve-confirm/reject-confirm/stale-version/error/partial`；Sources 的 `proposed/normalization_pending/dedupe_pending/adapter_check_pending/enqueued/enabled/manual_only/restricted/failed/disabled/unknown` 是页面 alias/可见文案，不是第二套领域状态；领域状态以 4.4 和已 ACK/frozen 的数据 v0.3 `collection_onboarding_status` 为准。
- 视觉与布局验收使用设计 Token/map 的 320/390/768/1024/1200/1440/1600px 宽度、深色/浅色、44px 触控目标、键盘焦点、对比度、`prefers-reduced-motion`、`forced-colors` 和 200% 缩放矩阵；状态不得只靠颜色表达。
- 设计合同第 11 节未决项在产品/开发签收前保持可追踪 unknown；本 ADR 不把 route hint、权限、字体许可证或 Appica/Base UI 正式依赖写成已确认事实。

### 3.2 M4 路由候选与权限边界

本轮把首批页面的实际路径冻结为产品候选合同，设计文件中的 `route_hint` 只作为视觉参考，不再承担业务路由真值：

| 页面 | 路径 | 角色/访问边界 | M4 状态 |
|---|---|---|---|
| 公开信息流 | `/` | 公开访客只读 | fixture/mock 读模型 |
| 内容详情 | `/stories/[publicId]` | 公开访客只读；`publicId` 只引用本地公开投影 | fixture/mock 读模型 |
| 审核队列 | `/admin/reviews` | loopback local-dev admin；不等同生产角色体系 | C 层页面/API，未验证 |
| 信源管理 | `/admin/sources` | loopback local-dev admin；状态与阻断原因可见 | C 层页面/API，未验证 |

后台页面与 `/api/admin/*` 共用 loopback、canonical Origin、会话和 CSRF fence；公开 GET 不改变状态。具体生产角色、部署域名、登录方式和跨网络访问权限仍为 unknown，必须在新任务/新 ADR 中单独确认。

## 4. 数据、provider 与 API 边界

### 4.1 本地最小状态

M4 首批只创建能支撑纵向切片的表：

| 表 | 作用 | 关键不变量 |
|---|---|---|
| `source_config_fixture` | M3 影子载荷的只读测试输入 | `source_id` 唯一；全部 fixture 标记；不写回 Base |
| `captured_item` | 手机/采集候选、raw URL 与规范化状态 | invalid 保留 `raw_url`；失败不生成 Content |
| `source_observation` | internal-only mock adapter 观察结果 | `source_id + external_id` 唯一；原始时间与发现时间分开；不成为领域/Base 真值 |
| `content_item` / `content_version` | 规范化内容与不可变修订 | 原始引用不被覆盖；版本变更使后续 Bundle 失效 |
| `event` | 跨内容事件聚合与确定性去重 | canonical 成员可追溯；重复不公开 |
| `summary` | `Summary(summary_status=draft)` 的 mock 中文标题/摘要；生成过程 metadata 进入 internal contract | 没有单独的草稿实体；无网络、无工具、无发布权 |
| `media_candidate` | fixture/无图候选 | 权利与安全状态显式；失败可无图继续 |
| `release_bundle` / `review_decision` | 最终公开载荷与绑定 hash | 通过前不得形成公开投影；Bundle 不可变 |
| `publication` | 本地公开读模型 | `public_id` 稳定；修订不创建第二条逻辑内容 |
| `inbox` / `outbox` / `task_attempt` / `dead_letter` | durable 任务边界 | 业务幂等键唯一；任务 envelope 携带 `source_config_epoch`、`source_safety_epoch` 及 runtime fence metadata，旧版本不能更新当前状态 |
| `audit_event` | internal-only 本地脱敏审计 | 不含 token、原文全文、私密标识或内部堆栈；不成为领域/Base 真值 |

M4 不把运行指标、调用量、队列年龄、错误堆栈或凭证状态写入 `source_config_fixture`；运行遥测只写本地结构化日志/测试报告。任务提交前必须比较 `source_config_epoch`、`source_safety_epoch`、`authorization_version`、`policy_epoch` 和 `recovery_epoch`；授权/合规停用或安全策略变更递增相应版本，旧任务进入停止/查询分支，不能写入当前状态。

字段、状态机、幂等键和合成安全样例以 [`data/mvp-contract-v0`](../../../data/mvp-contract-v0/) 为唯一领域合同输入：`schema.json`、`base-mapping.json`、`state-machine.json`、`fixtures.synthetic.json` 和 `manifest.json` 必须先通过其机械校验。当前路径的 `runtime-envelope.schema.json` 已生成 v0.3 artifact，`TASK-20260802-D80846` 已完成并由统筹部 ACK；首轮 v0.3 安全/测试复验的时态 P1 已由安全/测试聚焦复验 `PASS / P0=0 / P1=0` 收口。内部 TaskEnvelope 引用该已 ACK/frozen 输入，本任务不改写 data。M3 的 33/9 字段只映射到 `Source`/`CapturedItem`；`Content`、`Event`、`Summary`、`MediaCandidate`、`ReleaseBundle`、`ReviewDecision`、`Publication`、`OutboxJob` 是本地域实体，不反写 M3 或 Base。若本 ADR 的表名/字段与该 schema 冲突，记录为新的数据部修订项，不在 Spec 另造第二套字段。

`authorization_version`、`policy_epoch`、`recovery_epoch` 是任务 envelope 的 runtime fence metadata，不是 `data/mvp-contract-v0` 的领域属性、Base 映射字段或第二套产品 schema；M4 可并应在本地 durable inbox/outbox/task lease 的内部 envelope 中持久化它们，以支持崩溃恢复。`source_config_epoch` 与 `source_safety_epoch` 仍从领域 `Source` 合同读取并复制到 envelope。该内部 envelope 的字段校验和迁移由开发部代码 ADR/机械 schema 另行固化，不能修改数据部领域合同。

### 4.2 Provider 合同

```text
SourceConfigProvider.read_snapshot(request)
  -> { provider_kind, source_config_epoch, source_safety_epoch, revision, sources, read_evidence, runtime_fence }

Adapter.poll(config, cursor, lease, deadline, source_config_epoch, source_safety_epoch, runtime_fence)
  -> { observations, next_cursor, rate_limit_state, error_class }

runtime_fence = { authorization_version, policy_epoch, recovery_epoch }

`source_config_epoch` is copied from the provider snapshot; the adapter must reject a mismatch before any provider call.

Provider kinds:
  fixture        # M4 唯一启用，读取脱敏/合成本地 fixture
  base_direct    # 仅接口桩；真实 Base 读取需 A provider 门禁
  base_snapshot  # 仅接口桩；真实 D 快照需 D 门禁
```

`fixture` 只代表开发测试输入，不代表第二业务真值。M4 禁止把 fixture 的写入结果传播到真实 Base、Collector 或外部平台；`base_direct`/`base_snapshot` 不允许通过环境变量直接启用。

VS-1 的本地持久化顺序固定为一个事务：先写入唯一 `source_observation`，再写入唯一业务操作的 inbox、比较并更新当前 epoch/CAS，最后写出对应 outbox 意图；事务提交前不得确认任务完成。进程崩溃只能留下完整提交或全部回滚，重启按唯一操作 ID 查询，不盲重放。

### 4.3 本地 HTTP/API 合同

只实现本地纵向切片需要的最小接口，命名和载荷先作为候选合同：

| 方法 | 路径 | 用途 | M4 状态 |
|---|---|---|---|
| GET | `/api/public/feed?cursorAt=&cursorId=&source=&contentType=` | 公开信息流；游标与来源/内容类型筛选 | fixture/mock 数据，可读 |
| GET | `/api/public/stories/{publicId}` | 详情、来源证据、原链、无图/状态 | fixture/mock 数据，可读 |
| GET | `/api/admin/sources` | 本地信源状态与 unknown/失败状态 | `APP_ENV=local/test` only |
| GET | `/api/admin/reviews` | 审核队列与 Bundle hash | `APP_ENV=local/test` only |
| POST | `/api/admin/reviews/{bundleId}/approve` | 合成审核通过 | 仅本地 mock；必须重验 hash |
| POST | `/api/admin/reviews/{bundleId}/reject` | 合成审核拒绝 | 仅本地 mock；记录原因 |
| POST | `/api/admin/publications/{publicId}/publish` | 手动发布已批准 Bundle 到本地投影 | 仅本地 mock；必须重验批准 hash，禁止自动触发 |
| POST | `/api/admin/publications/{publicId}/correct` | 本地更正并生成新版本 | 仅本地 mock；旧版本失效并回审核 |
| POST | `/api/admin/publications/{publicId}/withdraw` | 本地下架公开投影 | 仅本地 mock；不调用外部发布接口 |
| POST | `/api/admin/stop` | 本地急停演练 | 默认停止，不能影响真实系统 |

客户端只接收公开 DTO 或脱敏后台 DTO；不得返回原始平台包、提示词、凭证、内部错误堆栈、任务拓扑或私密 URL。

所有 `/api/admin/*` 只在 loopback 绑定下可用：`APP_BIND_HOST` 必须为 `127.0.0.1` 或 `::1`，拒绝对外绑定和代理转发；变更请求还必须通过本地开发会话、同源 `Origin` 检查和一次性 CSRF nonce。local-dev 会话由进程启动时生成、以 HttpOnly/SameSite=Strict cookie 保存，CSRF nonce 由本地页面/内部 route 按会话签发；不使用静态默认密码或仓库凭证。缺少任一条件即拒绝，M4 不把该入口当作生产认证方案。

### 4.4 信源入队前置条件与可达状态

信源领域状态唯一来自已 ACK/frozen 数据 v0.3 的 `collection_onboarding_status`：`validating → activation_pending → queued → collecting → active`。规范化与查重仍是 `Source.normalization_status`/`Source.dedup_status` 的 guard，不另造 onboarding 状态。页面可以把 `validating + normalization_status=pending` 显示为 `normalization_pending`，把 `validating + dedup_status=pending` 显示为 `dedupe_pending`，把 `activation_pending` 显示为 `adapter_check_pending`，把 `queued` 显示为“已入队”；这些均为 alias。

进入 `activation_pending` 前必须同时满足 `canonical_url_valid=true`、`normalization_status=valid`、`dedup_status=unique`；`pending`、`needs_review`、`invalid` 和 `linked_existing` 不得继续。激活检查的三门为：

1. `adapter_ready`：已登记的 adapter 能力与版本可用；
2. `authorization_valid`：该操作的授权/grant/token scope 仍有效；
3. `platform_allowed`：平台条款、限流和合规策略允许本次采集。

身份、F1 相关性和内容质量可以是 `unknown`，不得替代上述三个门。若多个门同时失败，阻断状态按 `platform > authorization > adapter` 唯一选择。三门、规范化/查重、`source_stop_status=clear` 和五个 fence 均通过时，`activation_pending → queued` 是一个原子事务：复用当前 `onboarding_operation_id`，同时写入 `Source.enabled=true`、`collection_onboarding_status=queued`、唯一 activation outbox，并让 Source、TaskEnvelope、Outbox 逐字复用同一 `operation_id`。外部环境变量不能单独改变 enabled；worker 取得 lease 后才允许 `queued → collecting`。

| 判断 | canonical 状态 | 允许的后继 |
|---|---|---|
| 平台不允许、限流策略阻断或合规停用 | `blocked_platform` | 策略/平台恢复后回 `activation_pending`，重验三门、查重、stop 和五 fence |
| 授权失效、scope 不足或 ACL unknown | `blocked_authorization` | 新授权收据后回 `activation_pending`，重验三门、查重、stop 和五 fence |
| adapter 缺失/版本不兼容 | `blocked_adapter_missing` | adapter ready 后回 `activation_pending`，重验三门、查重、stop 和五 fence |
| 已发现相同规范 URL/归属 | `linked_existing` | 关联既有 Source；不得重复入队 |
| 三门、规范化/查重和五 fence 均通过 | `queued` → `collecting` | 同一 operation id；先 lease，再消费 |
| 用户停用或急停 | `stopped`/`cancelled` | 新 epoch 后显式恢复或人工重新创建；不自动回弹 |
| adapter、授权、平台检查以外的可重试故障 | `queue_failed`/`collection_failed` | 有界重试或人工修复后回 `activation_pending`，重新取得 gates/fences |
| 失败预算耗尽 | `dead_letter` | 保留审计，人工复核后才允许新操作 |

`paused` 只属于 `lifecycle_status`，不写入 `collection_onboarding_status`。`validating`、`activation_pending`、`queued`、`collecting`、`active`、`normalization_failed`、`dedup_needs_review`、`linked_existing`、`blocked_adapter_missing`、`blocked_authorization`、`blocked_platform`、`queue_failed`、`collection_failed`、`stopped`、`cancelled`、`dead_letter` 均须在 fixture、API 和 UI 中有至少一条可达路径；每个 blocked/retry/resume/stop/cancel/dead-letter 出口都重新检查 gates 和五个 fence。`lifecycle_status` 的 `proposed/active/paused/retired`、`normalization_status` 的 `pending/valid/invalid/needs_review`、`dedup_status` 的 `pending/unique/linked_existing/needs_review` 和 identity/relevance/monitorability 的 `unknown` 另按数据 schema 展示。`manual_only`、`restricted`、`enabled` 是策略/字段/页面 alias，不可写成 `collection_onboarding_status` 的第三套 enum；`unknown` 不得渲染为正常启用。数据部 v0.3 负责把同一转换原位写入唯一机器合同，本 ADR 不复制第二套状态枚举。

### 4.5 领域发布合同、TaskEnvelope 与版本栅栏

以下字段是产品/安全/测试共同修订的接口语义，实际 JSON Schema 已由 `TASK-20260802-D80846` 在 `data/mvp-contract-v0/` 原位升级到 `mvp-local-v0.3`；此前 v0.2 数据任务已交付并 ACK，当前 v0.3 修订已完成并由统筹部 ACK，首轮安全/测试复验后的唯一时态 P1 已由两份聚焦复验 PASS 收口，数据产物保持冻结输入。若机器合同无法无歧义承载，须新建数据修订任务并保持本 ADR 的 accepted 核心不变，不在 Spec 或 ADR 另造字段。

**不可变领域对象。** 已 ACK/frozen 的数据 v0.3 `ReleaseBundle` 使用 `release_bundle_id`、`bundle_version`、`content_id`、`summary_id`、`content_version_hash`、`summary_version_hash`、`source_evidence_url`、`canonical_json_rule_version`、`canonical_payload`、`payload_hash`、`bundle_hash_input`、`bundle_hash`、`release_status`、`immutable`、`media_refs` 和五类运行时 fence。`content_version_hash` 输入对象与 v0.3 `content_hash_input` 一致：`content_id`、`source_id`、`external_content_id`、`canonical_url`、`content_kind`、`content_version`、`normalized_title`、`normalized_body`、`language`、`source_evidence_url`、`source_config_epoch`；`capture_id`、`external_url`、`published_at`、`captured_at` 等字段进入 Content/release payload，但不在该 version-hash 对象中。`summary_version_hash` 输入对象与 v0.3 `summary_hash_input` 一致：`summary_id`、`content_id`、`summary_version`、`title_zh`、`summary_zh`、`language=zh-CN`、`source_evidence_url`、`input_content_hash`、`summary_schema_version`、`summarizer`、`deterministic=true`；这些是已 ACK/frozen 的 Summary 字段，其他生成过程运行 metadata 才进入 internal contract。两类 hash 排除状态、已有 hash、写入时间和操作者字段，按 `canonical-json-v1` 从字段对象重算；未来字段变化须由数据部新任务统一修订后重验。

release canonical payload 是由既有领域字段生成的冻结投影，不增加第二套持久化 schema；`canonical_payload` 必须包含 `release_bundle_id`、`content_snapshot`、`summary_snapshot`、source snapshot、original URL、rights snapshot、media hash/license/safety snapshot、policy version、schema version 和五个 fence。source snapshot 取 Source 的 `source_id`、`canonical_url`、`platform`、`identity_status`、`source_config_epoch`、`source_safety_epoch`；original URL 取 Content 的 `external_url`/`canonical_url`。rights/media/policy/schema 若 v0.3 机器合同缺少可复算输入，作为数据部修订项阻断定版。`payload_hash = SHA-256(canonical-json-v1(canonical_payload))`；`bundle_hash_input` 固定为 `{release_bundle_id,bundle_version,payload_hash,canonical_json_rule_version,immutable}`，`bundle_hash = SHA-256(canonical-json-v1(bundle_hash_input))`；`approved_bundle_hash` 必须等于 `bundle_hash`。任一冻结字段变化都创建新 Bundle（新 id 或递增 version）并使旧批准 supersede。

**公开身份与对账。** 同一 `(release_bundle_id, approved_bundle_hash)` 只有一条 `Publication`、一个稳定 `public_id` 和一个单调 `publish_generation`。`Publication.idempotency_key` 是 publish Outbox/TaskEnvelope 的唯一 canonical key，三者逐字相等；`Publication.reconcile_key` 只用于同一 Publication 的查询。发布状态 canonical 名称为 `queued`、`publishing`、`published`、`retryable_failed`、`reconcile_wait`、`terminal_failed`、`blocked`、`emergency_stopped`。`publishing → reconcile_wait` 后只能沿同一 key 查询；确认成功转 `published`，确认未提交转有界 `retryable_failed`/人工重试，终态失败转 `terminal_failed`，急停转 `emergency_stopped`。所有出边保留同一 `public_id`、generation、idempotency_key 和 reconcile_key，禁止第二 Publication、第二 public_id、分裂 key、盲重试或自动触发外部发布器。`PublishedProjection` 只读派生自该 Publication，复用 identity/version hash。
Publication 的其余 required fields（publication_id、content/summary 引用、approved content/summary hashes、published version hash、reconcile_status/reconcile_attempt、急停和错误/时间字段）以 v0.3 唯一 schema 为准；本 ADR 不创建第二字段集。
`Publication.retryable_failed` 只能沿同一 key 回到 `queued`/`publishing`，并重新核对批准 hash、manual-only、五 fence 和人工操作；`blocked` 在阻断清除后回 `queued`；`reconcile_wait` 只允许确认成功、确认未提交、终态失败或急停。Outbox retryable failure 只能复用原 operation/idempotency key 重新排队；stale、cancelled、dead-letter 只表示内部任务结果。任何恢复都不创建第二 Publication/public_id，也不切换 provider。

**审核与内部记录。** `ReviewDecision` 以 `review_decision_id`、`content_id`、`summary_id`、`release_bundle_id`、`review_version`、`decision`、`approved_bundle_hash`、`reviewer_ref`、`reviewed_at`、`decision_reason`、`decision_hash_input`、`decision_hash`、`canonical_json_rule_version`、`immutable` 和五类 fence 为准。`decision_hash_input` 只含 `review_decision_id`、`release_bundle_id`、`approved_bundle_hash`、`review_version`、`decision`、`canonical_json_rule_version` 和五个 fence；`decision_hash=SHA-256(canonical-json-v1(decision_hash_input))`。未批准 Bundle 不得公开。没有单独的草稿实体，草稿就是领域 `Summary(summary_status=draft)`；只有生成过程的 input/model/schema hash 等运行元数据进入 internal contract。session、reason 和 reject 证据写入 internal-only `AuditEvent`，不进入领域/Base 字段。

**Hash 规则。** `canonical_json_rule_version` 固定为 `canonical-json-v1`；对象键按 Unicode code point 排序、数组保持语义顺序、数字为有限 JSON 数字、显式 null 保留、`ensure_ascii=false` 且不做 NFC/NFD 归一化、逗号/冒号无空白，拒绝 NaN/Infinity/指数重写和隐式类型转换。`approved_bundle_hash` 与任务 envelope 的 `payload_hash` 语义分离，publish/correct/withdraw 必须在同一事务比较当前 Bundle、批准 hash、版本、`manual_only`、五 fence、session/Origin/CSRF 和幂等 key。

**内部 TaskEnvelope。** 固定字段为：

```text
schema_version, envelope_type, task_id, operation_id, aggregate_type, aggregate_id, payload_hash,
source_config_epoch, source_safety_epoch,
authorization_version, policy_epoch, recovery_epoch,
lease_token, lease_expiry, deadline, attempt, idempotency_key, reconcile_key
```

以上字段与 [`runtime-envelope.schema.json`](../../../data/mvp-contract-v0/runtime-envelope.schema.json) 的必填属性保持一一对应；`reconcile_key` 可空，publish/reconcile envelope 必须与同一 Publication 的 `reconcile_key` 逐字相等，其他任务为 null。TaskEnvelope 是 OutboxJob 的内部嵌套合同，不成为领域实体或 Base 映射。Source、TaskEnvelope、Outbox 对同一采集激活复用 `operation_id`，publish Outbox/TaskEnvelope 复用 Publication 的 `idempotency_key`。live envelope 的五 fence、epoch 与 `attempt` 从 1 起，`epoch=0` 永远 schema 拒绝；`attempt` 不超过关联 `max_attempts`，`lease_token` 必须承载至少 128 bit CSPRNG opaque 值，满足 `now < lease_expiry <= deadline <= now + MAX_TASK_WINDOW`，且 `MAX_TASK_WINDOW` 为有限实现常量。缺失、`Unknown`、默认 0、负值或非单调 epoch 一律 fail closed。取得 lease、调用 provider/adapter 前、outbox dispatch 前、当前状态/提交 outbox 前以及 publication 的 publish/correct/withdraw 前，都必须做同一事务可见的五 fence CAS；`lease_token` 原子匹配且过期即失效。stop、授权失效或合规停用递增对应 epoch，旧 worker 不能 ack/commit；新任务应在 60 秒内停止，旧结果只进入 internal-only 审计或同一 Publication 的 `reconcile_wait` 查询，不更新当前状态，恢复不自动回弹。outbox 的 stale epoch、cancelled、dead_letter 只表示内部任务结果，不升级为领域公开状态。

### 4.6 物理表到领域实体与 fixture 分层

物理存储只允许一份映射，以下是 M4 物理表到领域实体或 internal-only 记录的候选映射；字段/枚举以数据部 v0.3 唯一合同为准。唯一映射约束指 M3 33/9 字段到 `Source`/`CapturedItem` 及领域实体的关系；`inbox`、`outbox`、`task_attempt`、`dead_letter`、`source_observation`、`audit_event` 是内部运营记录，TaskEnvelope 作为 OutboxJob 的嵌套合同，不属于领域 schema 或 Base 映射：

| 物理表/集合 | 领域实体 | 读写归属 | 边界 |
|---|---|---|---|
| `source_config_fixture` | `Source` | fixture provider 只读 | 对应 M3 33 字段；不写回 M3 |
| `captured_item` | `CapturedItem` | intake service | 9 字段手机捕获与规范化结果；不成为 Source 真值 |
| `source_observation` | internal-only `SourceObservation` record | adapter/repository | `source_id + external_id` 幂等；不成为领域实体、Base 真值或公开状态 |
| `content_item` / `content_version` | `Content` | normalization/review | 不可变版本，原始证据独立保留 |
| `event` | `Event` | dedupe service | 关联成员可追溯 |
| `summary` | `Summary(summary_status=draft)` | fixture summary | 草稿为领域 Summary 状态；生成过程 metadata internal-only；不创建第二实体 |
| `media_candidate` | `MediaCandidate` | fixture/none media | 无图可继续 |
| `release_bundle` | `ReleaseBundle` | review service | 不可变，hash 绑定 |
| `review_decision` | `ReviewDecision` | local admin | 人工批准/拒绝；会话证据由 internal-only `AuditEvent` 绑定/追踪 |
| `publication` | `Publication` | publication service | 公开读投影，稳定 `public_id` |
| `published_projection` | `PublishedProjection` | publication read model | 由已发布 `Publication` 派生的只读 projection；不生成第二 `public_id` 或第二发布真值 |
| `inbox` / `outbox` / `task_attempt` / `dead_letter` | `TaskEnvelope`/`OutboxJob` | worker/repository | runtime fence 在内部 envelope，不回写 M3 |
| `audit_event` | internal-only `AuditEvent` record | append-only audit | allowlist、append-only monotonic_seq、clock_status、redaction_version、retention/cleanup；不存 secret/original/private ID/stack |

fixture 以 `seed-layers.json` 分层且互斥，唯一三层为：`m3-shadow-seed`（59×33，批次 `M3-20260801-X59-01`，全部 `enabled=false`）、`synthetic-case-seed`（包含 domain synthetic、published projection 与 snapshot reconciliation 子集，并各自保留 manifest/hash/count 元数据）、`security-error-seed`（P0 安全/错误样例）。公开投影和 snapshot reconciliation 不独立成第四/第五层；snapshot failure 不得与 stale epoch 共用 job。不得混入真实账号内容、真实 URL、凭证或媒体下载，使用 `synthetic.invalid`/`synthetic:`，`external_calls=0`。此前 v0.2 数据任务已 ACK；当前 `TASK-20260802-D80846` 的 v0.3 修订已完成并由统筹部 ACK，首轮 v0.3 安全/测试复验的唯一时态 P1 已由两份聚焦复验 PASS 收口，本节保持三层冻结输入。

internal-only 合同引用已 ACK/frozen 的数据 v0.3 `data/mvp-contract-v0/internal-contract.schema.json`：`SourceObservation` 至少包含 `observation_id`、`source_id`、`external_id`、`observed_at`、可空 `published_at`、`cursor_ref`、`response_hash`、`error_class`、`source_config_epoch`、`source_safety_epoch`、`operation_id`、owner 和幂等 key；Summary 草稿仍是既有领域 Summary 的 `draft` 状态，只有生成过程的 input/model/schema hash 等运行元数据进入 internal contract；`AuditEvent` 至少包含 event_id、monotonic_seq、occurred_at、clock_status、trace/session_hash、reason_code、operation/task 引用、五个 epoch、attempt、payload/fixture/schema hash、redaction_version、retention/cleanup。该文件是 internal-only 运行合同，不增加领域实体或 Base 字段；若未来复验发现字段需调整，须由数据部新任务补齐或给出一一对应映射后再定版。

### 4.7 安全 A 层静态合同（R1–R13）

以下条款在 M4 启动、每次能力调用和所有 mutation 前均为 fail-closed 静态合同；B/C 代码与运行收据仍未验证。

| 编号 | A 层最小合同与拒绝条件 |
|---|---|
| R1 | capability registry 仅登记 fixture provider、mock adapter、fixture summary、fixture/none media、manual-only local publication；真实 provider、HTTP/DNS/socket、模型、媒体下载和外部发布不在 registry。应用配置命名空间实行 canonical allowlist：`REAL_FEISHU_IO`/`REAL_EXTERNAL_IO`/`REAL_FORM_SUBMIT` 只接受字面量 `false`，true/1/yes/空值/未知/解析异常拒绝；旧别名、`FEISHU_*`/`X_*`/`REDDIT_*`/`META_*`、`*_TOKEN`/`*_SECRET`/`*_PASSWORD`、`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`、`NODE_OPTIONS`/`NODE_PATH`、`DATABASE_URL`/`AUTO_PUBLISH`、`*_API_KEY`/`*_PRIVATE_KEY`/`*_CLIENT_SECRET` 和未知能力变量出现即拒绝（PATH/TMPDIR 等进程托管变量不属于应用配置命名空间）。fixture `realpath` 必须位于允许根，拒绝越界绝对路径、symlink/hardlink/TOCTOU/权限异常，并通过 schema/hash；每次调用前重断言 registry/profile 交集。 |
| R2 | `APP_BIND_HOST` 仅 `127.0.0.1`/`::1`；`APP_PORT` 为 1024–65535 十进制；`APP_PUBLIC_ORIGIN` 必须是 http + localhost/127.0.0.1/[::1] 且端口等于实际绑定端口，禁止 userinfo/path/query/fragment/wildcard；canonical origin 由实际 bind 生成，不信任 Host/Forwarded/X-Forwarded；CORS 与 wildcard ACAO 关闭；mutation 只接受一个精确匹配 Origin，GET 不改状态。 |
| R3 | session ID 与 CSRF nonce 使用 CSPRNG ≥256 bit、仅内存、重启失效、不写日志/URL/raw HTML；cookie 为 HttpOnly/SameSite=Strict/host-only/Path=/，HTTPS 才加 Secure、无 Domain；nonce 绑定 session_id/method/path/body hash/issued_at，TTL ≤10 分钟，原子 compare-and-consume + constant-time compare；重放、并发第二次、过期、缺失、错绑、旧 session、跨 Origin、GET mutation 拒绝；approve/reject/publish/correct/withdraw/stop 全部 JSON + fence。 |
| R4 | 日志/audit 采用 allowlist，默认不记录 headers/query/body/original/prompt/model output/private URL/stack/task topology；脱敏覆盖 Authorization/Cookie/Set-Cookie/access/refresh/OAuth code/api_key/secret/password/private URL/platform ID；未知或疑似 secret 字段阻止写日志并发出 redacted incident；verify-env、源码和 client bundle 扫描拒绝 secret/完整外部响应。 |
| R5 | 启动 `umask 077`；`.local`/临时目录 0700，DB、WAL/SHM/journal/backup 0600；`F1_DB_PATH` realpath 与父路径必须在允许根，拒绝 symlink/hardlink/TOCTOU，使用 O_NOFOLLOW/原子创建；verify-env/test:contract 覆盖路径、权限、WAL、恢复、并发。 |
| R6 | M4 `original_url` 仅 display-only safe DTO，服务端不抓取；media 仅 synthetic fixture/none，registry 无 http(s) fetch。未来 fetch 需新门禁、https、拒绝 userinfo/control/dangerous/private/IP/IPv4 变体/IPv6 mapped，逐跳 DNS/IP pinning、默认不跟随 redirect、禁止 proxy bypass、字节/时间/压缩上限（具体有限数值在启用 fetch 前的新 ADR 固定）；redirect 不接受任意 `next`，拒绝 javascript/data/协议相对/编码绕过。 |
| R7 | public/admin DTO text-only；禁 dangerouslySetInnerHTML、未审计 HTML/Markdown/CSS/URL 拼接；富文本须固定 sanitizer 与上下文编码；CSP、nosniff、frame-ancestors none、Referrer-Policy no-referrer；XML 禁 DTD/外部实体/网络并限字节/长度/深度/节点/解压/时间（具体有限数值在启用 parser 前的新 ADR 固定）；M4 media 拒绝 SVG/HTML/active content，未来解码在无网络无密钥隔离 worker，按 MIME/魔数/尺寸/像素/帧/时间上限，超限走无图。 |
| R8 | M4 summary 只允许 deterministic fixture，worker 无网络/DNS/socket/subprocess/tools/secrets/publish repo；不可信输入与固定 schema/长度/引用校验隔离，异常进入人工隔离；真实模型需新任务/供应商、区域、工具、密钥、输出与用户门禁。 |
| R9 | TaskEnvelope 固定 `schema_version/envelope_type/task_id/operation_id/aggregate_type/aggregate_id/payload_hash`、五 fence、`lease_token/lease_expiry/deadline/attempt/idempotency_key`；live 五 fence、epoch 与 attempt 从 1 起，`epoch=0` 永远 schema 拒绝，attempt 不超过关联 `max_attempts`，lease_token 至少承载 128 bit CSPRNG opaque 值，`now < lease_expiry <= deadline <= now + MAX_TASK_WINDOW` 且窗口有限；缺失/Unknown/默认0/非单调拒绝，`source_config_epoch` 为唯一 source config 命名；lease acquire、provider/adapter、outbox dispatch、state/outbox commit、publication mutation 前均做 CAS/fence；stop/授权/合规递增 fence，≤60 秒停新任务，旧结果只进入 internal-only 审计/reconcile，恢复不自动回弹。 |
| R10 | `content_version_hash`/`summary_version_hash` 从已 ACK/frozen v0.3 指定的不可变字段对象复算；ReleaseBundle 的 `canonical_payload` 冻结 content/summary snapshots、source snapshot（含 identity_status）、original_url、rights、media hash/license/safety、policy/schema 版本、五 fences，`payload_hash` 只 hash canonical_payload，`bundle_hash_input` 固定为 `{release_bundle_id,bundle_version,payload_hash,canonical_json_rule_version,immutable}` 并按 canonical-json-v1 复算，`approved_bundle_hash=bundle_hash`；ReviewDecision 的 `decision_hash_input` 与 `decision_hash` 也可重算；任何冻结证据或 fence 变化 supersede；Publication、publish Outbox、TaskEnvelope 共用唯一 `idempotency_key`，publish/reconcile envelope 的可空 `reconcile_key` 与同一 Publication 逐字相等；publish/correct/withdraw 单事务 + manual_only + session/Origin/CSRF + stable public_id；unknown outcome 只说明进入 `reconcile_wait`，同 key 查询，禁止第二 public_id/盲重试，自动发布器不存在。 |
| R11 | M4 无 Feishu auth SDK/command/credential/token state mutation；未来 A/D 版本化 operation→granular scope→ACL，缺失/额外 scope 或 ACL unknown fail closed，不自动 offline_access/write/delete/permission；login/logout/refresh/revoke/reauthorize/rotation/真实 Base 需新任务、收据、用户确认。 |
| R12 | dependency bootstrap 与 runtime no-egress 分账；`npm ci` 仅用户批准网络/审计离线缓存，lock/lifecycle/secret 扫描；verify-env/check/test/contract/dev/worker 在 deny-all 下，仅允许 `127.0.0.1`/`::1` loopback，`external_calls=0` 覆盖 DNS/HTTP/raw socket/subprocess/child_process/proxy，任一外联先写 redacted security event 后非零退出。 |
| R13 | 每个 task/operation/review/publish/stop/reconcile 记录 synthetic trace、脱敏 payload/fixture/schema hash、epoch、attempt、错误分类、状态、下一动作；unknown capability/env、Origin/CSRF/session reject、secret scan、egress attempt、stale-fence/schema/hash reject 也必须记录 redacted reason_code、trace/session_hash 和 epoch；internal-only `AuditEvent` 采用 allowlist、append-only monotonic_seq、clock_status、redaction_version、retention/cleanup，`additionalProperties=false`，禁 secret/original/private ID/stack；retention/清理/时钟异常在测试报告声明。 |

### 4.8 A/B/C 门禁与 P0 闭环矩阵

| 轴 | 允许事项 | 本轮状态 | 阻断条件 |
|---|---|---|---|
| A 静态合同 | 定义路由、状态、领域/内部边界、版本候选、安全 predicate、fixture 分层和失败路径 | **accepted**；安全/测试聚焦复验均 `PASS / P0=0 / P1=0`，首轮 FAIL 历史保留 | 发现用户/accepted ADR 冲突、第二 schema 或统一基线无法映射 |
| B accepted 后初始化 | 生成 `package.json`、lockfile、`.nvmrc`/`.node-version`、`.npmrc`、canonical 目录和最小脚手架 | **completed**；静态初始化与 `package-lock.json` 已通过开发/安全/测试审计，`node_modules` 当前存在且被 gitignored | 版本漂移、未知 env、依赖/目录/许可检查失败 |
| C 实现验收 | Node24 安装、SQLite WAL/事务/recovery、UI/API/安全/deny-all/contract/build/test 收据 | **local preflight PASS**；Node24/npm ci/SQLite/lint/typecheck/build 及两路独立复验通过，允许 VS-0；Repository/UI/API/完整 R12/VS-1–3 仍 pending | 任一真实外联、engine/SQLite/安全/状态/幂等证据失败 |

P0 闭环对照：

| 项 | 修订后唯一落点 | 当前判定 |
|---|---|---|
| P0-01 | 本节 4.4 原子 enable+queued、规范化/查重门、blocked 优先级、operation id 复用；Spec §4–§5、§7.3、§9 | A 轴 accepted；B/C 实现可达性待验证 |
| P0-02 | 4.5 `reconcile_wait` 查询状态机、失败/恢复出边与同一 Publication/key；Spec §5、§7.1、§9 | A 轴 accepted；B/C 实现可达性待验证 |
| P0-03 | 4.5 TaskEnvelope 五 fence、epoch0 永拒、128-bit lease、`idempotency_key` 与可空 `reconcile_key` 完整必填字段；`runtime-envelope.schema.json` | A 轴 accepted；内部运行/CAS 收据待验证 |
| P0-04 | 4.5 ReleaseBundle/ReviewDecision/Publication；4.6 单一领域映射与 internal-only 记录 | A 轴 accepted；C 层实现对齐待验证 |
| P0-05 | 4.6 三层 seed，published projection/snapshot reconciliation 为 synthetic 子集 | A 轴 accepted；C 层运行收据待验证 |
| P0-06 | 2.2/4.8 Node24 exact candidate，B/C 分离 | A 不阻断；C 本地预检 PASS，业务 C 未验证 |
| P0-07 | 4.4 所有阻断/停止/unknown 可达要求、retry/resume 出口、`paused` 生命周期边界 | A 轴 accepted；状态机/UI/API 收据待验证 |
| P0-08 | 4.5 `published`、唯一 public_id/key；三条 projection 属 synthetic 层子集；4.6、Spec §7.3 | A 轴 accepted；C 层 fixture 运行收据待验证 |
| P0-09 | 4.7 R1–R13 精确 A 层 predicate，尤其可重建 hash 与 internal-only AuditEvent | A 轴 accepted；B/C 安全运行收据待验证 |

## 5. 安全开关与环境变量合同

`.env.example` 只写以下变量名和安全默认值，不写真实值：

```text
APP_ENV=local
APP_PORT=3000
APP_BIND_HOST=127.0.0.1
APP_PUBLIC_ORIGIN=http://127.0.0.1:3000
F1_DB_PATH=.local/f1plus1.sqlite
SOURCE_CONFIG_PROVIDER=fixture
SOURCE_FIXTURE_PATH=../data/m3-base-shadow-import-v0/main-source-record-batch.json
ADAPTER_MODE=mock
SUMMARY_MODE=fixture
MEDIA_MODE=fixture
PUBLISH_MODE=manual_only
REAL_FEISHU_IO=false
REAL_EXTERNAL_IO=false
REAL_FORM_SUBMIT=false
ADMIN_ACCESS_MODE=local_dev_only
LOG_LEVEL=info
```

启动校验必须拒绝以下组合：

- `APP_ENV` 不是 `local`/`test` 且 `ADMIN_ACCESS_MODE=local_dev_only`；
- `APP_BIND_HOST` 不是 loopback 地址；
- `SOURCE_CONFIG_PROVIDER` 不等于 `fixture`，`ADAPTER_MODE` 不等于 `mock`，`SUMMARY_MODE` 不等于 `fixture`，`MEDIA_MODE` 不在 `{fixture,none}`，或 `PUBLISH_MODE` 不等于 `manual_only`；
- 任一 `REAL_*` 为 `true`；
- Node 版本不是允许的 24.x Active/Maintenance LTS；`verify:env` 只依据本地 `process.versions.node`、项目 `engines` 和已记录的 LTS policy，不访问网络查询版本；
- fixture 路径不在仓库允许目录、输入含凭证模式或 schema 校验失败。

真实凭证变量名只在后续独立 ADR 中定义；M4 不创建 `FEISHU_*`、`X_*`、`REDDIT_*`、`META_*` 或 AI provider secret。所有 `NEXT_PUBLIC_*` 变量必须是非敏感展示配置。

开发部预检报告中的 `DATABASE_URL`、`SOURCE_PROVIDER`、`REAL_BASE_ENABLED`、`AUTO_PUBLISH` 等仅为 disposable probe 示例；M4 的 canonical 变量以本节为准，不允许两套变量混用。`F1_DB_PATH` 必须解析到仓库内 `.local/` 或测试临时目录，拒绝任意绝对路径。

## 6. 本地命令合同

以下命令已写入 `app/package.json`；`npm ci --ignore-scripts`、`lint`、`typecheck`、`build` 已有 C 层预检 PASS 收据，其余命令属于 VS-0 或后续 C 业务验收：

```text
npm ci                         # lockfile 安装
npm run verify:env             # Node LTS、安全开关、fixture 路径和秘密扫描
npm run db:migrate             # 本地 SQLite 只追加迁移
npm run seed:fixtures          # 脱敏/合成 fixture；不读真实 Base
npm run dev                    # Next.js 本地开发服务器
npm run worker:mock            # 只消费 fixture/mock inbox/outbox
npm run test                   # Vitest 单元、合同、失败路径
npm run test:contract          # 本地 HTTP/in-process 路由合同，不连外部平台
npm run lint                   # ESLint
npm run typecheck              # TypeScript
npm run build                  # 本地 production build 检查
npm run check                  # verify-env + lint + typecheck + test + test:contract + build
```

首次启动顺序固定为：`verify:env → db:migrate → seed:fixtures → worker:mock`，另开终端运行 `dev`；`REAL_*` 和 provider 开关在整个 M4 期间保持 fail-closed。

## 7. 首批纵向切片

### VS-0：安全地基与 fixture provider（已允许本地开工）

- 输入：本地 M3 离线载荷/合成观察样本。
- 输出：SQLite migration、环境校验、fixture provider、脱敏日志、基础 health 页面。
- 验收：错误 Node/路径/开关拒绝启动；fixture 59 条保持 `enabled=false`；不产生外部网络请求。

### VS-1：来源读取、规范化、确定性查重与 outbox

- 输入：fixture source + mock feed observation。
- 输出：规范 URL、来源/事件时间双时间轴、`source_id + external_id` 幂等、inbox/outbox、`source_config_epoch`/`source_safety_epoch`/`authorization_version`/`policy_epoch`/`recovery_epoch` fencing。
- 验收：重复投递只产生一个逻辑事件；旧版本结果不更新当前状态；观察记录、inbox 唯一键、CAS 和 outbox 意图遵守同一事务；使用 synthetic timestamps 检查本地处理顺序与 15 分钟目标的时间预算，但不宣称真实平台 SLO；429/5xx/损坏 fixture 按错误类别停止或有界重试。

### VS-2：中文整理、媒体降级与人工审核

- 输入：合成/公共领域文本；fixture media 或无图。
- 输出：领域 Summary 的 `summary_status=draft`（生成过程 metadata internal-only）、`MediaCandidate`、不可变 `ReleaseBundle`、可重建 Bundle Hash、审核队列；不创建单独的草稿实体。
- 验收：提示注入/字段越界/恶意媒体样本隔离；无图可继续；编辑或任一来源/权利/schema 变化会使旧审核失效。

### VS-3：本地公开读模型与发布急停

- 输入：人工 mock approve 的 Bundle。
- 输出：本地信息流、详情、来源证据/原链、`public_id` 稳定的公开投影、手动发布/更正/下架和本地急停；对应 API 保持 manual-only。
- 验收：未审核不能公开；相同幂等键不生成第二 public ID；发布超时或未知结果进入唯一 canonical 状态 `reconcile_wait`，unknown 只描述进入该状态的原因，随后按同一 key 查询；急停阻止新公开项，恢复不自动回弹。

真实 Base、真实适配器、真实表单、外部 AI、外部图片和自动发布不属于上述切片；它们只能在各自门禁后另起任务。

## 8. 替代方案与选择理由

| 方案 | 结论 | 原因 |
|---|---|---|
| Python FastAPI + React/Next.js | 暂不选 | 后台与前台两种语言、两套 schema/构建/运行命令；个人维护成本更高 |
| Next.js + PostgreSQL + Redis | 暂不选作 M4 | 生产并发更强，但需要额外服务、部署和备份，当前未获部署/付费授权 |
| Next.js + SQLite（本 ADR） | 选择 | 本地单人、零远程服务、事务/唯一约束可验证；通过 repository 保留迁移出口 |
| 微服务/第三方自动化 | 排除 | 当前容量不足以证明拆分收益；安全、权利、幂等与对账依赖外部能力 |
| 直接接 Base/真实平台 | 排除 | 违反本轮真实采集、provider、表单提交和真值门禁；M4 先验证本地闭环 |

## 9. 风险、回滚与三条失败路径

### 9.1 失败路径

1. **付费/境外依赖路径：** 发现某技术选择要求付费、境外托管或中国大陆不可达的运行时服务时，保持 `fixture/mock`，改用本地 SQLite/文件 fixture，并将真实能力列为新门禁；不得默认采购或切换。
2. **合同冲突路径：** 发现本 ADR/Spec 与 accepted ADR-SOURCE-001、用户确认或设计规范冲突时，停止冻结，提交精确冲突位置；不得修改 accepted ADR，不得继续实现冲突路径。
3. **真实平台不可证路径：** 无法证明真实平台的授权、条款、15 分钟可行性或安全控制时，维持 mock adapter/fixture provider；实验结果只能标为 local-only，不能写成生产可用。

### 9.2 回滚

- 配置/迁移失败：停止 worker，保留 migration 记录与本地 DB 副本；用下一条追加 migration 修复，不删除历史。
- fixture/schema 漂移：拒绝启动，恢复上一份锁定 fixture/manifest；不把异常 fixture 写入公开投影。
- 任务/公开投影异常：提升 `recovery_epoch`，取消旧 lease，保留最后一致读模型；通过业务幂等键查询后再定向重放。
- M4 任何本地纵向切片都不能触碰真实 Base、provider、Collector 或外部发布；若边界开关被误改，进程立即 fail closed 并保留脱敏审计。

## 10. 验收与用户门禁

### 本 ADR accepted 验收

- 技术栈、替代方案、成本/中国大陆约束、模块/数据/API 边界、app 布局、环境变量和本地命令均有明确合同。
- 首批 4 个纵向切片有输入、输出、失败路径和可验证出口。
- 此前 v0.2 数据任务已 ACK；当前 `TASK-20260802-D80846` 的 v0.3 schema、33/9 映射、状态/幂等/不变量、三层 fixture、`runtime-envelope.schema.json` 和 internal-only contract 已交付并由统筹部 ACK，作为唯一冻结合同输入；安全/测试首轮 v0.3 复验的唯一时态 P1 已由两份聚焦复验 `PASS / P0=0 / P1=0` 收口。M3 shadow 与 domain-only 实体边界不反写，A 轴静态合同已 accepted。
- A 轴 P0-01–P0-09 与 R1–R13 已分别落到 4.4–4.8、Spec 7.1–7.3 和 P0 矩阵；任务版本栅栏包含 `source_config_epoch`、`source_safety_epoch`、`authorization_version`、`policy_epoch`、`recovery_epoch` 以及 lease/deadline/attempt；原子 enable+queued、唯一 operation/publication/key、可重建 hash、internal-only audit 和 loopback admin/CSRF 条件有明确验收出口。
- 公开路由候选为 `/`、`/stories/[publicId]`、`/admin/reviews`、`/admin/sources`；新信源三门入队条件为 adapter ready、authorization valid、platform allowed；发布未知唯一使用 `reconcile_wait` 与同 key 对账。
- `fixture` 与真实 `base_direct`/`base_snapshot` 的边界清晰，未改变 accepted ADR 的真值/切换不变量。
- 付费、部署、外发、真实采集、真实表单提交、自动发布均有 fail-closed 开关和独立门禁。

### 进入 C 轴业务实现验收前仍需

- B 层静态 `app/` 初始化、package/lock/版本文件和最小 scaffold 已完成并通过审计；Node24/npm ci/SQLite/lint/typecheck/build 的 C 层预检已通过，允许开始 VS-0；
- Repository 正式实现、migration/CAS/lease/outbox 与 fixture seed 仍待实现和验收；
- UI/API、admin session/Origin/CSRF、完整 R12 deny-all、VS-1–3 和无障碍/AT 证据仍待 C 层业务实现验收；
- 设计预览、响应式、无障碍和 AT 证据在 C 轴实现验收中提供；已核收的设计合同作为 A/B 开工输入，不再新增 UI 方向确认门禁；
- 用户另行决定任何真实平台、AI、图片、部署、付费和公开发布门禁。
- 任何未来飞书只读都必须先通过本 ADR 的 granular permission profile 与三层权限门禁；本地 M4 不执行重授权、撤权、logout 或 token 轮换。

## 11. 未验证项与变更规则

- 本 ADR 已记录此前 `mvp-local-v0.2` 数据任务交付/ACK；当前 `TASK-20260802-D80846` 的 v0.3 修订已完成并由统筹部 ACK，首轮安全/测试复验后的唯一时态 P1 已由两份聚焦复验 `PASS / P0=0 / P1=0` 收口。D27E44、7BFD99、6F480F 的 C 层本地预检均已 `PASS / P0=0 / P1=0`；仍未验证 Collector 的 `base_direct`/`base_snapshot` provider 实读与生产可用性、Repository/业务实现、UI/API、完整 R12、VS-1–3、M3 直接协作者、OAuth 最小 grant 收敛、平台费用/许可、AI 数据条款、图片权利、部署可达性、容量、RTO/RPO 和生产安全；M3 CLI 资源/表/记录回读已由独立执行收据验证。
- Node24 `node:sqlite` 3.53.1 的事务/锁/recovery 本地 spike 已通过；Repository 封装、migration、生产存储、多实例和网络文件系统仍需后续 C 门禁，发现新缺口时提交新的 proposed ADR，不原地改本 ADR 核心决定。
- 本 ADR 的 A 轴静态合同状态为 `accepted`。B 层静态初始化与 C 层本地预检已完成；当前允许 VS-0 安全地基与 fixture provider 本地开工，Repository/UI/API、完整 R12、VS-1–3、真实 provider、部署、自动发布、付费、跨境 AI 或数据库升级都必须新建任务/ADR并取得相应门禁与用户确认；accepted 核心不得原地修改。

## 12. 变更记录

| 日期 | 版本 | 变更 | 原因 |
|---|---|---|---|
| 2026-08-02 | A 轴 accepted 收口 | 吸收 `TASK-20260802-8B5DCF` 及安全/测试聚焦复验 `TASK-20260802-337780`、`TASK-20260802-ABB9F8` 的 `PASS / P0=0 / P1=0`；建立本文件为唯一 canonical accepted 入口，保留旧 proposed 路径为跳转说明；仅开放 B 层本地初始化，C 层与真实外部能力继续关闭 | 首轮 FAIL 历史与当前 PASS 审计链均保留；不改 data、app 或历史审核报告 |
| 2026-08-02 | v1 候选修订 | 吸收 `TASK-20260802-5BAF26` 与第二轮测试/安全复验：固定规范化/查重前置、platform > authorization > adapter、原子 enable+queued 与 operation id 复用；固定单一 Publication/public_id/key、可重建 content/summary/release hash、internal-only `SourceObservation`/生成 metadata/`AuditEvent`、三层 seed、epoch0 schema 拒绝和数据 ACK/复验 FAIL 时态；ADR 保持 proposed | 统一 v0.3 基线要求关闭跨合同 P0/P1；不改 data/app/accepted ADR，不触发真实 IO |
| 2026-08-02 | v1 候选修订 | 吸收开发/安全/测试三方复核：关闭 A 轴 P0-01–P0-09，补齐三门入队状态机、canonical 路由、ReleaseBundle/ReviewDecision/Publication、TaskEnvelope/`runtime-envelope.schema.json` 候选、canonical hash、`reconcile_wait`、fixture 分层、R1–R13 静态 predicate 和 A/B/C 门禁；保持 ADR/Spec proposed | TASK-20260802-131D64；数据部 v0.2、app 初始化和 Node24/SQLite/UI/安全运行证据仍为并行或后置未验证 |
| 2026-08-02 | 历史实施状态同步（已由 84F061 更新） | 记录 `TASK-20260802-7F3D22` 的前一轮 B/C 状态收据；当前实施状态以 `TASK-20260802-84F061` 的 C 层预检 PASS 与 VS-0 窗口记录为准 | 保留状态变更审计链，不将前一轮时态作为现行门禁 |
| 2026-08-02 | C 层预检状态同步 | 吸收 D27E44、7BFD99、6F480F 的 `PASS / P0=0 / P1=0`：Node24.18.0/npm11.16.0、SQLite3.53.1、`npm ci --ignore-scripts`、lint/typecheck/build 和两路复验通过；`node_modules` 当前存在且被 gitignored，允许 VS-0；Repository/UI/API/完整 R12/VS-1–3 与真实外部能力仍 pending/closed | 保留首轮 FAIL、延迟清理误删 node_modules 及恢复/复验历史；不改 data/design/app 或 accepted 核心 |
| 2026-08-01 | v1 候选 | 固化 M4 本地 Kickoff 技术栈、provider/adapter/mock 边界、数据领域合同引用、飞书权限 profile、app 目录合同、本地命令、首批纵向切片、设计实现级合同吸收和 fail-closed 门禁 | 用户授权本地技术选型与 app 开工；真实端口、依赖安装、生产存储、平台、部署、付费、外发、真值/provider、真实采集/表单提交和自动发布仍需单独确认 |
